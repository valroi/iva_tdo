import { Segmented } from "antd";

import { useI18n } from "../i18n";
import type { Lang } from "../i18n";

/** Переключатель языка RU/EN. Компактный, для шапки и портала подрядчика. */
export default function LanguageSwitcher({ size = "small" }: { size?: "small" | "middle" }): JSX.Element {
  const { lang, setLang } = useI18n();
  return (
    <Segmented
      size={size}
      value={lang}
      options={[
        { label: "RU", value: "ru" },
        { label: "EN", value: "en" },
      ]}
      onChange={(v) => setLang(v as Lang)}
    />
  );
}
