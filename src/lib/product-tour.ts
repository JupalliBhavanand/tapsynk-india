import { INDIA_PLANS } from "@/lib/plans";

export const productTourChapters = [
  { id: "product-intro", label: "One tap. Your next opportunity.", text: "Ready to make your next introduction count? Meet TapSynk! One tap shares your business, saves your contact, and opens the door to your next opportunity. No app. Just a great connection." },
  { id: "how", label: "A smarter way to connect.", text: "Make it yours in minutes. Share your card with a tap, a QR code, or your personal link. New role? New number? Update once, and your profile is ready to go!" },
  { id: "email-signatures", label: "Make every sign-off stand out.", text: "Now take your brand into the inbox. Choose a stunning email signature, add your own style, and turn every email into a direct link to your TapSynk profile. A small detail. A big impression!" },
  { id: "ai", label: "Keep your business moving.", text: "And with the AI Card, your next conversation doesn't have to wait. Your assistant answers questions, captures leads, and books meetings. Link your own Google account, and let Calendar and Google Meet keep you connected." },
  { id: "pricing", label: "Make your next introduction count.", text: `Get the Virtual Card for ${INDIA_PLANS.virtual.amount / 100} rupees as a one-time payment. Or choose the AI Card for ${INDIA_PLANS.ai.amount / 100} rupees per month. Both include free NFC card delivery in India. Ready for your next great connection? Start with TapSynk!` },
];
export const productTourVersion = `india-v1-${INDIA_PLANS.virtual.amount}-${INDIA_PLANS.ai.amount}`;
