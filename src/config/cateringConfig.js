// Catering slider packs and terms, from the MunchiesKK slider catering
// flyer. Each pack is SLIDERS_PER_TRAY sliders. Sliders aren't sold on the
// regular menu, so prices live here rather than in menu_items. All prices
// are in sen (RM 1.00 = 100), same as menu_items.price.

export const SLIDERS_PER_TRAY = 20;

export const SLIDER_TRAYS = [
  {
    id: 'kawan-bbq',
    name: 'Kawan BBQ Pack',
    contents: '20 BBQ Beef',
    price: 16000,
  },
  {
    id: 'double-bbq',
    name: 'Double BBQ Pack',
    contents: '10 BBQ Beef + 10 BBQ Chicken',
    price: 16500,
  },
  {
    id: 'monsta-party',
    name: 'Monsta Party Pack',
    contents: '6 BBQ Beef, 6 BBQ Chicken, 4 Big-G, 4 Mushy2 Chicken',
    price: 17500,
  },
  {
    id: 'monsta-beef',
    name: 'Monsta Beef Pack',
    contents: '10 BBQ Beef, 5 Big-G, 5 Mushy2',
    price: 18000,
  },
  {
    id: 'sabah-signature',
    name: 'Sabah Signature Pack',
    contents: '5 each: Big-G, Mushy2, Jucy Bae, Sumandak',
    price: 20900,
  },
];

export const FRIES_TRAY = {
  id: 'fries',
  name: 'Fries Pack',
  contents: '20 portions',
  price: 8500,
};

// The new flyer sets no minimum order, so one slider pack is enough.
// Minimum and the multi-pack discount count slider packs only (not fries).
export const MIN_SLIDER_TRAYS = 1;
export const BULK_DISCOUNT = { minTrays: 3, perTray: 1000 };
export const DELIVERY_FROM = 1500;
export const DEPOSIT_PERCENT = 50;
