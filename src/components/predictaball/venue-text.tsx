import { translateVenue } from "@/lib/venue-he";

/**
 * Renders a venue string translated to Hebrew where a mapping exists.
 * Untranslated (foreign) segments are wrapped LTR inside the RTL layout.
 */
export function VenueText({ venue }: { venue: string }) {
  const parts = translateVenue(venue);
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((part, i) => (
        <span key={`${part.text}-${i}`}>
          {i > 0 ? " · " : null}
          {part.isHebrew ? (
            part.text
          ) : (
            <span dir="ltr" className="inline-block">
              {part.text}
            </span>
          )}
        </span>
      ))}
    </>
  );
}
