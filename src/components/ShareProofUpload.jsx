import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { compressImage } from '../utils/compressImage';
import { loyaltyConfig } from '../config/loyaltyConfig';
import './ShareProofUpload.css';

// Lets a customer send a screenshot of their social post for one collected
// order. Staff approve it in Admin > Share proofs, and the order's share
// bonus is then topped up to SHARE_PROOF_TOTAL_PTS.
export default function ShareProofUpload({ orderId }) {
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [proof, setProof] = useState(null); // { status, reject_reason } | null
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.id || !orderId) return undefined;
    let active = true;
    supabase.from('share_proofs')
      .select('status, reject_reason')
      .eq('order_id', orderId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setProof(data || null);
        setLoaded(true);
      });
    return () => { active = false; };
  }, [user?.id, orderId]);

  if (!user?.id || !loaded) return null;

  const total = loyaltyConfig.SHARE_PROOF_TOTAL_PTS;
  const extra = total - loyaltyConfig.REVIEW_BONUS_PTS;

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError('Please choose a screenshot or photo.'); return; }
    setBusy(true);
    setError('');
    try {
      const small = await compressImage(file, { maxSide: 1280, quality: 0.8 });
      const ext = (small.name.split('.').pop() || 'webp').replace(/[^A-Za-z0-9]/g, '').slice(0, 5) || 'webp';
      const safeOrder = String(orderId).replace(/[^A-Za-z0-9._-]/g, '_');
      const path = `${user.id}/${safeOrder}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('share-proofs')
        .upload(path, small, { contentType: small.type || 'image/webp', upsert: false });
      if (upErr) throw upErr;
      const { error: rpcErr } = await supabase.rpc('submit_share_proof', { p_order_id: orderId, p_image_path: path });
      if (rpcErr) throw rpcErr;
      setProof({ status: 'PENDING', reject_reason: null });
    } catch (err) {
      console.warn('[ShareProofUpload]', err);
      setError(err?.message?.includes('not eligible')
        ? 'This order is too old to earn the screenshot bonus.'
        : 'Could not send the screenshot. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (proof?.status === 'APPROVED') {
    return (
      <p className="share-proof share-proof-ok"><CheckCircle2 size={16} /> Screenshot approved. Thank you for sharing!</p>
    );
  }
  if (proof?.status === 'PENDING') {
    return (
      <p className="share-proof share-proof-wait"><Clock size={16} /> Screenshot received. We'll check it soon and add +{extra} points.</p>
    );
  }

  return (
    <div className="share-proof">
      {proof?.status === 'REJECTED' && (
        <p className="share-proof-no"><XCircle size={16} /> We couldn't approve your last screenshot{proof.reject_reason ? `: ${proof.reject_reason}` : '.'} You can send another.</p>
      )}
      <p className="share-proof-copy">
        Posted it? Upload a screenshot of your post (tag <strong>@munchieskk</strong>) and get <strong>+{extra} more points</strong> ({total} in total) once we approve it.
      </p>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      <button type="button" className="btn btn-outline share-proof-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        <ImagePlus size={18} /> {busy ? 'Sending…' : 'Upload screenshot'}
      </button>
      {error && <p className="share-proof-err">{error}</p>}
    </div>
  );
}
