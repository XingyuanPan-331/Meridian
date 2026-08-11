// Plan View Time Conversion Layer
// Handles the visual→real date mapping for the midnight section (23:00-02:00)
//
// In Plan view: 23:00-02:00 is shown as an extension of the current day
// In reality:    00:00-02:00 belongs to the NEXT calendar day
//
// visualTimeToRealTime():  UI drag target → database date
// realTimeToVisualTime():  database date → UI display position

const MIDNIGHT_START = 24; // Hours 23+ on visual day X actually belong to day X+1

/**
 * Convert visual display time to real database time.
 * 
 * When user drags a task to "Monday midnight 00:30",
 * they see it on Monday's timeline, but the real time is Tuesday 00:30.
 * 
 * @param displayDate - The date shown on screen (e.g. "2026-07-27" for Monday)
 * @param hour - The hour on the visual timeline (0-25)
 * @param minute - The minute
 * @returns Real date and hour for database storage
 */
export function visualTimeToRealTime(
  displayDate: string, hour: number, minute: number
): { date: string; hour: number; minute: number } {
  // Hours 23+ on the display actually map to the next calendar day
  if (hour >= MIDNIGHT_START) {
    const d = new Date(displayDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    const realDate = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    return { date: realDate, hour: hour - 24, minute };
  }
  // Normal hours: display date IS the real date
  return { date: displayDate, hour, minute };
}

/**
 * Convert real database time to visual display position.
 * 
 * Task stored at "Tuesday 00:30" should display on "Monday midnight" section.
 * 
 * @param realDate - The actual calendar date from database (e.g. "2026-07-28" Tuesday)
 * @param hour - The actual hour (0-23)
 * @returns Display date and hour for positioning on the timeline
 */
export function realTimeToVisualTime(
  realDate: string, hour: number
): { displayDate: string; displayHour: number } {
  // Early morning hours (0-7) on a calendar day are shown as midnight of the PREVIOUS day
  if (hour >= 0 && hour < 3) {
    const d = new Date(realDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const visualDate = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    return { displayDate: visualDate, displayHour: hour + 24 };
  }
  // Normal hours: display date = real date
  return { displayDate: realDate, displayHour: hour };
}

/**
 * Build local ISO datetime string without timezone conversion.
 */
export function fmtLocalISO(date: string, hour: number, minute: number): string {
  if (hour < 0 || hour > 23) {
    console.error("[fmtLocalISO REJECTED] invalid hour:", hour, "date:", date);
    throw new Error("fmtLocalISO: hour must be 0-23, got " + hour);
  }
  return date + "T" + hour.toString().padStart(2, "0") + ":" + minute.toString().padStart(2, "0") + ":00";
}
