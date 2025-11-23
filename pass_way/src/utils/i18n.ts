import ar from "../locales/ar.json";
import en from "../locales/en.json";

const translations: Record<string, any> = { en, ar };

export function t(lang: string, key: string, ...args: any[]): string {
  let translation =
    key.split(".").reduce((o, i) => o?.[i], translations[lang]) || key;

  if (args.length > 0) {
    translation = translation.replace(/{(\d+)}/g, (match: any, index: any) => {
      return args[index] !== undefined ? args[index].toString() : match;
    });
  }

  return translation;
}
