import { MEATS, MEAT_LABEL, baseMeat, choiceCharge } from '../utils/meatSwaps';
import './MeatChoices.css';

const money = (cents) => (cents / 100).toFixed(2);

// "Choose your meat" for a burger, or one choice per burger on a platter.
// Prices shown here are for the customer's eyes only; the server prices the
// order itself.
export default function MeatChoices({ slots, swapSlots, ladder, menu, choices, onChange }) {
  if (!slots.length) return null;

  const setChoice = (slotNo, patch) =>
    onChange(choices.map((c) => (c.slot === slotNo ? { ...c, ...patch } : c)));

  const slotLabel = (slot) => (slots.length === 1 && !slot.pick_category ? 'Meat' : `Burger ${slot.slot_no}`);

  const pickable = (slot) =>
    (menu || []).filter((m) => m.category === slot.pick_category);

  // "All chicken" / "All lamb": set every swappable slot at once.
  const swappable = slots.filter((s) => !s.pick_category || baseMeat(s, choices.find((c) => c.slot === s.slot_no)?.item_id, swapSlots));
  const setAll = (meat) =>
    onChange(choices.map((c) => {
      const slot = slots.find((s) => s.slot_no === c.slot);
      return baseMeat(slot, c.item_id, swapSlots) ? { ...c, meat } : c;
    }));

  return (
    <div className="meat-choices">
      <h3 className="modal-addons-title">{slots.length > 1 ? 'Choose your burgers' : 'Choose your meat'}</h3>
      {slots.length > 1 && swappable.length > 1 && (
        <div className="meat-quick">
          <span>All:</span>
          {MEATS.map((m) => (
            <button type="button" key={m} className="meat-quick-btn" onClick={() => setAll(m)}>{MEAT_LABEL[m]}</button>
          ))}
        </div>
      )}
      {slots.map((slot) => {
        const choice = choices.find((c) => c.slot === slot.slot_no) || {};
        const base = baseMeat(slot, choice.item_id, swapSlots);
        return (
          <div className="meat-slot" key={slot.slot_no}>
            <div className="meat-slot-label">{slotLabel(slot)}</div>
            {slot.pick_category && (
              <select
                className="meat-pick"
                value={choice.item_id || ''}
                aria-label={`${slotLabel(slot)} burger`}
                onChange={(e) => {
                  const id = e.target.value;
                  const nextBase = baseMeat(slot, id, swapSlots);
                  setChoice(slot.slot_no, { item_id: id, meat: nextBase || '' });
                }}
              >
                <option value="">Choose a burger</option>
                {pickable(slot).map((m) => {
                  const soldOut = m.inStock === false || (m.stock_quantity ?? 1) < 1;
                  return <option key={m.id} value={m.id} disabled={soldOut}>{m.name}{soldOut ? ' (sold out)' : ''}</option>;
                })}
              </select>
            )}
            {base && (
              <div className="meat-options" role="radiogroup" aria-label={`${slotLabel(slot)} meat`}>
                {MEATS.map((meat) => {
                  const extra = choiceCharge(slot, { ...choice, meat }, swapSlots, ladder);
                  const selected = choice.meat === meat;
                  return (
                    <button
                      type="button"
                      key={meat}
                      role="radio"
                      aria-checked={selected}
                      className={`meat-option${selected ? ' selected' : ''}`}
                      onClick={() => setChoice(slot.slot_no, { meat })}
                    >
                      {MEAT_LABEL[meat]}{extra > 0 ? ` +RM ${money(extra)}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
            {slot.pick_category && choice.item_id && !base && (
              <div className="meat-fixed">The meat on this burger can't be changed.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
