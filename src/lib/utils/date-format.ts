// Central date formatting helpers for Bangla reports

export function formatReportDateBangla(date: Date | string): string {
  let day: string;
  let month: string;
  let year: string | number;

  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parts = date.split("-");
    year = parts[0];
    month = parts[1];
    day = parts[2];
  } else {
    const d = new Date(date);
    day = String(d.getDate()).padStart(2, "0");
    month = String(d.getMonth() + 1).padStart(2, "0");
    year = d.getFullYear();
  }

  const englishDate = `${day}-${month}-${year}`;
  // ইংরেজি সংখ্যা বাংলায় কনভার্ট:
  const banglaDigits: Record<string, string> = {
    "0": "০", "1": "১", "2": "২", "3": "৩", "4": "৪",
    "5": "৫", "6": "৬", "7": "৭", "8": "৮", "9": "৯",
  };
  const banglaDate = englishDate.replace(/[0-9]/g, (match) => banglaDigits[match]);
  return `তারিখ : ${banglaDate}`;
}
