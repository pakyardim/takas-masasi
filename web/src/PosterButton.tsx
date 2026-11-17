// "Görsel oluştur" button: builds a poster canvas on click and opens the share dialog.
import { useState } from "preact/hooks";
import { makeShare, ShareModal, type Share } from "./ShareModal";

export function PosterButton({ make, name, label = "Görsel oluştur" }: {
  make: () => Promise<HTMLCanvasElement> | HTMLCanvasElement; name: string; label?: string;
}) {
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      setShare(await makeShare(await make(), name));
    } catch (e) {
      alert("Görsel oluşturulamadı: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button class="ghost" onClick={open} disabled={busy}>{busy ? "Hazırlanıyor…" : label}</button>
      {share && <ShareModal share={share} onClose={() => setShare(null)} />}
    </>
  );
}
