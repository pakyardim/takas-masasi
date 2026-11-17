// Preview + download dialog for a generated poster (PNG and JPG), shared by all tabs.
import { useEffect, useState } from "preact/hooks";

export interface Share { url: string; png: Blob; jpg: Blob; name: string; size: string }

const slug = (s: string) => s.toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]+/g, "-").replace(/^-|-$/g, "");
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Görsel oluşturulamadı"))), type, q));

/** Turn a drawn canvas into downloadable PNG + JPG. */
export async function makeShare(canvas: HTMLCanvasElement, baseName: string): Promise<Share> {
  const [png, jpg] = await Promise.all([toBlob(canvas, "image/png"), toBlob(canvas, "image/jpeg", 0.92)]);
  return { url: URL.createObjectURL(png), png, jpg, name: slug(baseName), size: `${canvas.width}×${canvas.height} piksel` };
}

const kb = (b: Blob) => (b.size >= 1e6 ? `${(b.size / 1e6).toFixed(1)} MB` : `${Math.round(b.size / 1024)} KB`);

export function ShareModal({ share, onClose }: { share: Share; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [jpgUrl] = useState(() => URL.createObjectURL(share.jpg));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); URL.revokeObjectURL(jpgUrl); };
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": share.png })]);
      setMsg("Panoya kopyalandı. WhatsApp'a yapıştırabilirsin.");
    } catch {
      setMsg("Kopyalanamadı (tarayıcı izin vermedi). İndirme düğmelerini kullan.");
    }
  };
  return (
    <div class="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal-box">
        <div class="modal-head">
          <h3 style="margin:0">Paylaşılabilir görsel</h3>
          <div class="modal-actions">
            <a class="primary btn" href={share.url} download={share.name + ".png"}>PNG indir</a>
            <a class="ghost btn" href={jpgUrl} download={share.name + ".jpg"}>JPG indir</a>
            <button class="ghost" onClick={copy}>Kopyala</button>
            <button class="ghost" title="Kapat" onClick={onClose}>✕</button>
          </div>
        </div>
        <div id="share-msg" class="muted small">{msg || `${share.size} · PNG ${kb(share.png)} · JPG ${kb(share.jpg)}`}</div>
        <div class="modal-body"><img src={share.url} alt="Paylaşılabilir görsel" /></div>
      </div>
    </div>
  );
}
