// Catering sliders and terms, from the MunchiesKK slider flyer. Sliders
// are sold in lots of SLIDERS_PER_TRAY (one foil tray in the kitchen, but
// customers only ever see them called "sliders", counted in pieces).
// Sliders aren't sold on the regular menu, so prices live here rather
// than in menu_items. All prices are in sen (RM 1.00 = 100), same as
// menu_items.price.

export const SLIDERS_PER_TRAY = 20;

export const SLIDER_TRAYS = [
  {
    id: 'bbq',
    name: 'BBQ Sliders',
    contents: '10 BBQ Beef + 10 BBQ Chicken, with our homemade BBQ sauce',
    price: 14000,
  },
  {
    id: 'party',
    name: 'Party Sliders',
    contents: '6 BBQ Beef, 6 BBQ Chicken, 4 Big-G, 4 Mushy2 Chicken',
    price: 15000,
  },
  {
    id: 'premium',
    name: 'Premium Sliders',
    contents: '5 each of Big-G, Mushy2, Jucy Bae and Sumandak, made with Sabah sambal tuhau',
    price: 19000,
  },
];

export const FRIES_TRAY = {
  id: 'fries',
  name: 'Fries',
  contents: '20 portions',
  price: 8500,
};

// Minimum order and the multi-tray discount both count slider trays only.
export const MIN_SLIDER_TRAYS = 2;
export const BULK_DISCOUNT = { minTrays: 3, perTray: 1000 };
export const DELIVERY_FROM = 1500;
export const DEPOSIT_PERCENT = 50;
