import { unstable_rethrow } from "next/navigation";
import {
  ANNOUNCEMENT_LEVEL_LABELS,
  formatAnnouncementInstant,
  getAnnouncementStrip,
  type AnnouncementLevel,
  type AnnouncementStripItem,
} from "@/modules/announcements";
import { dismissAnnouncementAction } from "./announcement-strip-actions";

// The strip of announcements at the top of every screen of a signed-in person (SPEC 2026-11-09-comunicacao-e-
// calendarios, 3.1 item 2 and 3.3 items 2 to 4; SF-236). Without announcements for the person, nothing is drawn.

/** Each level in its colors: a light background with a dark text, contrast of at least 4.5:1 (checked by the tests). */
export const STRIP_COLORS: Record<AnnouncementLevel, { background: string; border: string; text: string }> = {
  INFO: { background: "#e8f0fb", border: "#b9cde8", text: "#1e3a5f" },
  WARNING: { background: "#fff4e0", border: "#f0cf94", text: "#6b3a00" },
};

/**
 * The heading of an announcement: its level, or for a maintenance its phase with the window (SPEC 2026-11-09-
 * comunicacao-e-calendarios, 3.1 item 3; SF-238).
 */
export function stripHeading(announcement: Pick<AnnouncementStripItem, "level" | "phase" | "startsAt" | "endsAt">): { label: string; when: string | null } {
  if (announcement.phase === "scheduled") {
    return {
      label: "Manutenção programada",
      when: `De ${formatAnnouncementInstant(announcement.startsAt)} a ${formatAnnouncementInstant(announcement.endsAt)}.`,
    };
  }
  if (announcement.phase === "in_progress") {
    return { label: "Manutenção em andamento", when: `Até ${formatAnnouncementInstant(announcement.endsAt)}.` };
  }
  return { label: ANNOUNCEMENT_LEVEL_LABELS[announcement.level], when: null };
}

export function AnnouncementStripView({ announcements }: { announcements: readonly AnnouncementStripItem[] }) {
  if (announcements.length === 0) return null;

  return (
    <section aria-label="Avisos" className="announcement-strip">
      {announcements.map((announcement) => {
        const colors = STRIP_COLORS[announcement.level];
        const heading = stripHeading(announcement);
        return (
          <div
            className={`announcement-strip-item announcement-${announcement.level.toLowerCase()}`}
            key={announcement.id}
            // An urgent announcement is read out at once; an information one waits its turn.
            role={announcement.level === "WARNING" ? "alert" : "status"}
            style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.text }}
          >
            <p>
              <strong>{heading.label}:</strong> <strong>{announcement.title}</strong>
            </p>
            {heading.when ? <p>{heading.when}</p> : null}
            <p>{announcement.body}</p>
            {/* 3.3 item 4 (decision K5): only an information notice is dismissed. */}
            {announcement.dismissible ? (
              <form action={dismissAnnouncementAction} className="announcement-strip-dismiss">
                <input name="announcementId" type="hidden" value={announcement.id} />
                <button aria-label={`Dispensar o aviso ${announcement.title}`} className="button-secondary" type="submit">
                  Dispensar
                </button>
              </form>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Never breaks the page: without a session, or if reading fails, there is no strip. Next's own signals (a route that
 * turns dynamic by reading the session, a redirect) are rethrown, as `unstable_rethrow` asks.
 */
export async function AnnouncementStrip() {
  let announcements: AnnouncementStripItem[] = [];
  try {
    announcements = await getAnnouncementStrip();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return <AnnouncementStripView announcements={announcements} />;
}
