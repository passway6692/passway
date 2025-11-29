import { parse } from "date-fns";

export function combineDateAndTime(dateStr: string, timeStr: string): Date {
  // Parse dateStr in 'yyyy-MM-dd' format
  const parsedDate = parse(dateStr, "yyyy-MM-dd", new Date());

  // Validate parsedDate
  if (isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid date format for ${dateStr}. Expected yyyy-MM-dd.`);
  }

  // Parse timeStr (e.g., "08:00")
  const [hours, minutes] = timeStr.split(":").map(Number);

  // Validate hours and minutes
  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error(`Invalid time format for ${timeStr}. Expected HH:mm.`);
  }

  parsedDate.setHours(hours);
  parsedDate.setMinutes(minutes);
  parsedDate.setSeconds(0);
  parsedDate.setMilliseconds(0);

  return parsedDate;
}

export // Helper to convert DD-MM-YYYY → YYYY-MM-DD
function formatToISODate(dateStr: string): string {
  const [day, month, year] = dateStr.split("-");
  return `${year}-${month}-${day}`; // e.g., "2025-11-25"
}
