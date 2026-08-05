/**
 * Helper to calculate loyalty points per item according to MunchiesKK rules:
 * - Each PREMIUM item/combo/platter: 30 points
 * - Each Burger: 20 points
 * - Each Drink: 15 points
 * - All Fries: 10 points
 * - Other Items: 10 points default
 */
export function getItemPoints(item) {
  if (!item) return 0;
  const name = (item.name || '').toLowerCase();
  const category = (item.category || '').toLowerCase();

  // Premium rule: 30 points
  if (
    category.includes('premium') || 
    category.includes('combo') ||
    category.includes('platter') ||
    name.includes('premium') || 
    name.includes('combo') || 
    name.includes('platter') ||
    name.includes('monsta')
  ) {
    return 30;
  }

  // Burger rule: 20 points
  if (
    category.includes('bbq') || 
    category.includes('burger') || 
    name.includes('burger') || 
    name.includes('chix') || 
    name.includes('juicybae') || 
    name.includes('sumandak') ||
    name.includes('bigg') ||
    name.includes('lamb') ||
    name.includes('beef') ||
    name.includes('chicken')
  ) {
    return 20;
  }

  // Drink rule: 15 points
  if (
    category.includes('drink') || 
    name.includes('tea') || 
    name.includes('coke') || 
    name.includes('drink') || 
    name.includes('shake') || 
    name.includes('solero') ||
    name.includes('ice')
  ) {
    return 15;
  }

  // Fries rule: 10 points
  if (category.includes('fries') || name.includes('fries')) {
    return 10;
  }

  // Default fallback
  return 10;
}

export function calculateOrderPoints(items) {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((total, item) => {
    const qty = item.quantity || 1;
    return total + (getItemPoints(item) * qty);
  }, 0);
}
