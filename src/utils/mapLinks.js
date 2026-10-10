// Kept separate from DeliveryMap so pages can build map links without
// importing (and bundling) Leaflet, which only loads with the map itself.
export function pinLinks({ lat, lng }) {
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return {
    google: `https://www.google.com/maps?q=${ll}`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
  };
}
