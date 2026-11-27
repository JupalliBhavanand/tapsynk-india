/* eslint-disable @next/next/no-img-element -- Generated print artwork uses exact physical dimensions. */
"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight, Check, Copy, CreditCard, Download, Layers, Nfc, Printer, QrCode, Truck, X,
} from "lucide-react";
import { CARRIERS, STATUS_LABELS, countryName, orderStatusPatch, shippingLabel, type Order, type OrderPatch } from "./orders";
import { CARD_HEIGHT, CARD_WIDTH, cardSvg, downloadQr, loadCardLogo, printFilename, printPng, qrVector, saveFile, svgUrl, type Side } from "./print-assets";
import ui from "./orders.module.css";

type Props = {
  order: Order;
  initialSection: "print" | "nfc";
  copied: string;
  copy: (text: string, key: string, message: string) => Promise<void>;
  close: () => void;
  notify: (text: string, error?: boolean) => void;
  saving: boolean;
  onSave: (patch: OrderPatch, message: string) => Promise<boolean>;
  children: ReactNode;
};

export function OrderInspector({ order, initialSection, copied, copy, close, notify, saving, onSave, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const nfcSection = useRef<HTMLElement>(null);
  const printSheet = useRef<HTMLDivElement>(null);
  const title = useId();
  const trackingId = useId();
  const carrierId = useId();
  const [guides, setGuides] = useState(false);
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [zoom, setZoom] = useState<Side | null>(null);
  const [exporting, setExporting] = useState<Side | null>(null);
  const [logo, setLogo] = useState<{ url: string; image?: string }>();
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber);
  const [carrier, setCarrier] = useState(order.carrier);
  const [notes, setNotes] = useState(order.notes);
  const [shippingError, setShippingError] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [cardId, setCardId] = useState(order.cards[0]?.id ?? "");
  const card = order.cards.find((entry) => entry.id === cardId) ?? order.cards[0];
  const logoUrl = card?.cardDesign.logoUrl;
  const checksLocked = saving || ["shipped", "delivered", "cancelled"].includes(order.status);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element) return;
    element.showModal();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      setPortalTarget(document.body);
      if (initialSection === "nfc" && body.current && nfcSection.current) {
        nfcSection.current.scrollIntoView({ block: "start" });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      element.close();
      document.body.style.overflow = originalOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, [initialSection]);

  useEffect(() => {
    let current = true;
    if (logoUrl) {
      loadCardLogo(logoUrl).then(
        (image) => { if (current) setLogo({ url: logoUrl, image }); },
        () => { if (current) setLogo({ url: logoUrl }); },
      );
    }
    return () => { current = false; };
  }, [logoUrl]);

  const logoImage = logoUrl && logo?.url === logoUrl ? logo.image : undefined;
  const logoLoading = Boolean(logoUrl && logo?.url !== logoUrl);
  const logoFailed = Boolean(logoUrl && logo?.url === logoUrl && !logoImage);
  const canPrint = Boolean(card) && !logoLoading && !logoFailed;

  const address = order.shippingAddress;
  const canMarkShipped = order.status !== "cancelled" && order.status !== "delivered";
  const trackingFields = { trackingNumber: trackingNumber.trim(), carrier };
  const nfcCode = card ? svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
    qrVector(card.profileUrl) + "</svg>") : "";

  function checkedPrinted(checked: boolean) {
    const patch: OrderPatch = checked
      ? { cardPrinted: true, ...(order.status === "new" ? { status: "printing" } : {}) }
      : { cardPrinted: false, nfcEncoded: false, ...(order.status === "encoded" ? { status: "printing" } : {}) };
    void onSave(patch, checked ? "Card marked printed." : "Print verification cleared.");
  }

  function checkedEncoded(checked: boolean) {
    const patch: OrderPatch = checked
      ? orderStatusPatch(order, "encoded")
      : { nfcEncoded: false, ...(order.status === "encoded" ? { status: "printing" } : {}) };
    void onSave(patch, checked ? "NFC marked written and verified." : "NFC verification cleared.");
  }

  async function exportSide(side: Side) {
    if (!card) return;
    setExporting(side);
    try {
      const artwork = cardSvg(card, side, { bleed: true, logo: logoImage });
      const filename = printFilename(order.orderNumber, card) + "-" + side + "." + format;
      if (format === "svg") saveFile(artwork, filename, "image/svg+xml;charset=utf-8");
      else saveFile(await printPng(artwork), filename);
      notify((side === "front" ? "Front" : "Back") + " print file downloaded.");
    } catch {
      notify("The print file could not be generated. Try again.", true);
    } finally {
      setExporting(null);
    }
  }

  async function exportQr() {
    if (!card) return;
    try {
      await downloadQr(card, order.orderNumber);
      notify("NFC QR code downloaded.");
    } catch {
      notify("The QR code could not be downloaded.", true);
    }
  }

  async function print() {
    try {
      if (!printSheet.current) return;
      await Promise.all([...printSheet.current.querySelectorAll("img")].map((image) => image.decode()));
      document.body.dataset.ordersPrint = "true";
      window.print();
    } catch {
      notify("The print sheet could not be prepared.", true);
    } finally {
      delete document.body.dataset.ordersPrint;
    }
  }

  function saveShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShippingError("");
    if (!order.cardPrinted || !order.nfcEncoded) {
      setShippingError("Confirm the card was printed and the NFC chip was verified first.");
      return;
    }
    if (!trackingFields.trackingNumber || !carrier) {
      setShippingError("Enter a tracking number and choose a carrier.");
      return;
    }
    const update = order.status === "shipped" ? {} : orderStatusPatch(order, "shipped");
    void onSave({ ...update, ...trackingFields, notes: notes.trim() },
      order.status === "shipped" ? "Tracking and notes saved." : order.orderNumber + " marked shipped.");
  }

  return (
    <>
      <dialog ref={dialog} className={ui.drawer} aria-labelledby={title}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => {
          if (event.target !== dialog.current) return;
          const rect = dialog.current.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right ||
              event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}>
        <div className={ui.drawerTop}>
          <div>
            <div className={ui.drawerOrder}>
              <span>{order.orderNumber}</span>
              <span className={ui.statusBadge} data-status={order.status}>
                <span className={ui.statusDot} data-status={order.status} /> {STATUS_LABELS[order.status]}
              </span>
            </div>
            <h2 id={title}>Print, Encode &amp; Ship</h2>
            <p>{[order.customerName, order.company].filter(Boolean).join(" · ")}</p>
          </div>
          <button type="button" className={ui.iconButton} onClick={close} aria-label="Close order inspector"><X size={20} /></button>
        </div>

        <div className={ui.drawerBody} ref={body}>
          <section className={ui.drawerSection}>
            <div className={ui.sectionTitle}>
              <span className={ui.sectionIcon}><CreditCard size={17} /></span>
              <div><h3>Card Design &amp; Print Studio</h3><p>CR80 · 85.6 × 53.98 mm</p></div>
            </div>

            {order.planType === "team" && order.cards.length > 0 && (
              <label className={ui.stackLabel}>Card profile
                <select value={card?.id ?? ""} onChange={(event) => { setCardId(event.target.value); setZoom(null); }}>
                  {order.cards.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.profileSlug}</option>)}
                </select>
              </label>
            )}
            {!card ? <p className={ui.fieldHelp}>A card profile needs to be created before printing or encoding this order.</p> : <>
            <div className={ui.previewTools}>
              <button type="button" aria-pressed={guides} className={ui.outline} onClick={() => setGuides(!guides)}>
                <Layers size={15} /> {guides ? "Hide guides" : "Show bleed & safe zone"}
              </button>
              <span>{guides ? "Red trim · cyan safe zone" : "Select a side to enlarge"}</span>
            </div>

            <div className={ui.cardPair} data-zoom={Boolean(zoom)}>
              {(["front", "back"] as const).filter((side) => !zoom || side === zoom).map((side) => (
                <figure key={side}>
                  <button type="button" aria-pressed={zoom === side}
                    aria-label={zoom ? "Show front and back" : "Enlarge " + side}
                    onClick={() => setZoom(zoom ? null : side)}>
                    <img alt={card.name + " card " + side}
                      src={svgUrl(cardSvg(card, side, { bleed: guides, guides, logo: logoImage }))} />
                  </button>
                  <figcaption>{side === "front" ? "Front" : "Back"}</figcaption>
                </figure>
              ))}
            </div>

            <dl className={ui.specs}>
              <div><dt>Card finish</dt><dd>{card.cardDesign.finish || "Not recorded"}</dd></div>
              <div><dt>Accent colour</dt><dd><span className={ui.swatch} style={{ backgroundColor: card.cardDesign.accentColor }} />{card.cardDesign.accentColor}</dd></div>
              <div><dt>Name</dt><dd>{card.name}</dd></div>
              <div><dt>Role</dt><dd>{card.role || "—"}</dd></div>
              <div><dt>Company</dt><dd>{card.company || "—"}</dd></div>
              <div><dt>Logo</dt><dd>{logoLoading ? "Loading…" : logoFailed ? "Unavailable" : logoImage ? "Customer logo" : "Customer initials"}</dd></div>
            </dl>

            {order.planType === "team" && <p className={ui.fieldHelp}>These files are for the selected profile. Confirm the {order.quantity} cards included in the order before printing.</p>}
            {logoFailed && <p className={ui.fieldError} role="alert">The customer logo is unavailable. Restore the logo before exporting the print files.</p>}
            <div className={ui.assetControls}>
              <label className={ui.formatControl}>File format
                <select value={format} onChange={(event) => setFormat(event.target.value as "png" | "svg")}>
                  <option value="png">PNG · 300 dpi</option>
                  <option value="svg">SVG · vector</option>
                </select>
              </label>
              <div className={ui.drawerActions}>
                <button className={ui.outline} type="button" disabled={!canPrint || Boolean(exporting)} onClick={() => void exportSide("front")}>
                  <Download size={15} /> {exporting === "front" ? "Preparing front…" : "Download Print-Ready Front"}
                </button>
                <button className={ui.outline} type="button" disabled={!canPrint || Boolean(exporting)} onClick={() => void exportSide("back")}>
                  <Download size={15} /> {exporting === "back" ? "Preparing back…" : card.cardDesign.showQrOnBack ? "Download Back + QR" : "Download Back"}
                </button>
                <button className={ui.outline} type="button" disabled={!canPrint || !portalTarget} onClick={() => void print()}>
                  <Printer size={15} /> Print Card Sheet
                </button>
              </div>
              <p className={ui.fieldHelp}>Downloads include 3 mm bleed. Print the sheet at 100% scale for CR80 trim size.</p>
            </div>
            </>}
          </section>

          <section className={ui.drawerSection} ref={nfcSection}>
            <div className={ui.sectionTitle}>
              <span className={ui.sectionIcon}><Nfc size={18} /></span>
              <div><h3>NFC Programming &amp; Profile Link</h3><p>Use the same URL for the chip and backup QR code.</p></div>
            </div>
            {!card ? <p className={ui.fieldHelp}>The NFC URL will appear when a profile is available.</p> : <>
            <label className={ui.stackLabel}>NFC target URL
              <input readOnly className={ui.monoInput} value={card.profileUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <button type="button" className={ui.primary} onClick={() => void copy(card.profileUrl, "nfc", "NFC target URL copied.")}>
              {copied === "nfc" ? <Check size={16} /> : <Copy size={16} />}
              {copied === "nfc" ? "Copied!" : "Copy URL for NFC Write"}
            </button>
            <div className={ui.qrPanel}>
              <img src={nfcCode} alt={"Backup NFC QR code for " + card.name} width="86" height="86" />
              <div>
                <strong>Backup QR code</strong>
                {!card.published && <p role="status">This profile is unpublished. Publish and verify it before dispatch.</p>}
                <div className={ui.drawerActions}>
                  <button type="button" className={ui.outline} onClick={() => void exportQr()}><QrCode size={15} /> Download QR PNG</button>
                  <a className={ui.outline} href={card.profileUrl} target="_blank" rel="noopener noreferrer">Open Live Profile <ArrowUpRight size={14} /></a>
                </div>
              </div>
            </div>
            </>}
            <div className={ui.checklist}>
              <label><input type="checkbox" checked={order.cardPrinted} disabled={checksLocked || !card} onChange={(event) => checkedPrinted(event.target.checked)} /> {order.planType === "team" ? "All Cards Printed" : "Card Printed"}</label>
              <label><input type="checkbox" checked={order.nfcEncoded} disabled={!order.cardPrinted || checksLocked || !card} onChange={(event) => checkedEncoded(event.target.checked)} /> {order.planType === "team" ? "All NFC Chips Written & Verified" : "NFC Chip Written & Verified"}</label>
            </div>
          </section>

          <section className={ui.drawerSection}>
            <div className={ui.sectionTitle}>
              <span className={ui.sectionIcon}><Truck size={18} /></span>
              <div><h3>Shipping &amp; Tracking</h3><p>Copy the label and record dispatch.</p></div>
            </div>
            <dl className={ui.specs}>
              <div><dt>Recipient name</dt><dd>{order.customerName}</dd></div>
              <div><dt>Phone</dt><dd>{order.phone || "Not provided"}</dd></div>
              <div><dt>Address line 1</dt><dd>{address.line1 || "Not provided"}</dd></div>
              <div><dt>Address line 2</dt><dd>{address.line2 || "—"}</dd></div>
              <div><dt>City</dt><dd>{address.city}</dd></div>
              <div><dt>State / Province</dt><dd>{address.state}</dd></div>
              <div><dt>Postal code</dt><dd>{address.postalCode}</dd></div>
              <div><dt>Country</dt><dd>{countryName(address.country)}</dd></div>
            </dl>
            <button type="button" className={ui.outline} disabled={!address.line1} onClick={() => void copy(shippingLabel(order), "label", "Full shipping label copied.")}>
              {copied === "label" ? <Check size={15} /> : <Copy size={15} />}
              {copied === "label" ? "Copied!" : "Copy Full Shipping Label"}
            </button>

            <form className={ui.shippingForm} onSubmit={saveShipment}>
              <div className={ui.shippingFields}>
                <label className={ui.stackLabel} htmlFor={trackingId}>Tracking number
                  <input id={trackingId} placeholder="Enter tracking number" maxLength={100} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                </label>
                <div className={ui.stackLabel}>
                  <label htmlFor={carrierId}>Carrier</label>
                  <select id={carrierId} value={carrier} onChange={(event) => setCarrier(event.target.value)}>
                    <option value="">Choose a carrier</option>
                    {CARRIERS.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
              </div>
              {shippingError && <p role="alert" className={ui.fieldError}>{shippingError}</p>}
              {canMarkShipped && <button type="submit" className={ui.primary} disabled={saving}>
                <Truck size={16} /> {order.status === "shipped" ? "Save Tracking" : "Save & Mark Shipped"}
              </button>}
              <label className={ui.stackLabel}>Internal fulfillment notes
                <textarea rows={3} maxLength={1500} placeholder="Custom logo adjusted for bleed" value={notes}
                  onChange={(event) => setNotes(event.target.value)} />
              </label>
              <button type="button" className={ui.outline} disabled={saving || notes.trim() === order.notes}
                onClick={() => void onSave({ notes: notes.trim() }, "Fulfillment notes saved.")}>Save Notes</button>
            </form>
          </section>
        </div>
        {children}
      </dialog>
      {portalTarget && card && createPortal(
        <div className={ui.printSheet} ref={printSheet} aria-hidden="true">
          {(["front", "back"] as const).map((side) => (
            <img key={side} src={svgUrl(cardSvg(card, side, { logo: logoImage }))} alt=""
              style={{ width: CARD_WIDTH + "mm", height: CARD_HEIGHT + "mm" }} />
          ))}
        </div>, portalTarget,
      )}
    </>
  );
}
