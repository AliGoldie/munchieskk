import { supabase } from '../config/supabase';

/**
 * Validates a promo code against the Supabase database.
 * 
 * @param {string} code - The promo code to validate
 * @param {number} cartTotalCents - The current cart total in cents
 * @returns {Promise<{valid: boolean, message: string, discountCents: number, code: string}>}
 */
export async function validateAndApplyPromo(code, cartTotalCents) {
  if (!code) {
    return { valid: false, message: 'Please enter a promo code.' };
  }

  const upperCode = code.trim().toUpperCase();

  try {
    const { data: promo, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', upperCode)
      .single();

    if (error || !promo) {
      return { valid: false, message: 'Invalid promo code.' };
    }

    if (!promo.active) {
      return { valid: false, message: 'This promo code is no longer active.' };
    }

    if (promo.max_uses !== null && promo.usage_count >= promo.max_uses) {
      return { valid: false, message: 'This promo code has reached its usage limit.' };
    }

    // Calculate discount
    let discountCents = 0;
    if (promo.discount_type === 'percent') {
      discountCents = Math.floor(cartTotalCents * (promo.discount_value / 100));
    } else if (promo.discount_type === 'fixed') {
      discountCents = promo.discount_value;
    }

    // Ensure discount doesn't exceed cart total
    discountCents = Math.min(discountCents, cartTotalCents);

    return { 
      valid: true, 
      message: 'Promo code applied!', 
      discountCents, 
      code: upperCode 
    };

  } catch (err) {
    console.error('Error validating promo code:', err);
    return { valid: false, message: 'Error checking promo code. Please try again.' };
  }
}
