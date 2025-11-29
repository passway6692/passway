
export function getEgyptTime(date?: Date): Date {
  const now = date || new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
}

export function combineEgyptDateTime(dateStr: string, timeUtc: Date): Date {
  try {
    const cleanDateStr = dateStr.trim();
    let year: number, month: number, day: number;

    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleanDateStr)) {
      [year, month, day] = cleanDateStr.split('-').map(Number);
    } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(cleanDateStr)) {
      const parts = cleanDateStr.split('-').map(Number);
      [day, month, year] = parts;
    } else {
      throw new Error(`Invalid date format: "${cleanDateStr}". Use YYYY-MM-DD or DD-MM-YYYY`);
    }

    const localDate = new Date(year, month - 1, day);
    if (isNaN(localDate.getTime())) {
      throw new Error(`Invalid date: ${cleanDateStr}`);
    }

    const egyptOffset = 2 * 60 * 60 * 1000; 
    const egyptTime = new Date(timeUtc.getTime() + egyptOffset);
    
    return new Date(
      localDate.getFullYear(),
      localDate.getMonth(),
      localDate.getDate(),
      egyptTime.getHours(),
      egyptTime.getMinutes(),
      egyptTime.getSeconds(),
      egyptTime.getMilliseconds()
    );
  }catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Date/time combination failed: ${error.message}`);
    } else {
      throw new Error(`Date/time combination failed: ${String(error)}`);
    }
  }
}