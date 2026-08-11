import "./polyfills";

import { App as AntApp, ConfigProvider } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          // Брендбук «ИваМарис» 5.2: бирюза RAL 5018 + графит RAL 7016.
          colorPrimary: "#0F8B87",
          colorLink: "#0F8B87",
          colorSuccess: "#2E8B57",
          colorWarning: "#C98A16",
          colorError: "#C0392B",
          colorBgContainer: "#ffffff",
          colorBgElevated: "#ffffff",
          colorBgLayout: "#F2F3F3",
          colorBorder: "#E1E3E3",
          colorBorderSecondary: "#F3F4F4",
          colorTextBase: "#383E42",
          colorTextSecondary: "#47515D",
          colorTextTertiary: "#626C78",
          colorTextQuaternary: "#97A0AB",
          borderRadius: 9,
          borderRadiusLG: 12,
          borderRadiusSM: 7,
          fontFamily: '"Manrope", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 13,
          fontSizeLG: 14,
          lineHeight: 1.5,
          controlHeight: 34,
          controlHeightSM: 28,
          controlHeightLG: 42,
          // Теней почти нет — только лёгкая подсветка активных элементов.
          boxShadow: "0 1px 2px rgba(56,62,66,0.08)",
          boxShadowSecondary: "0 2px 10px rgba(56,62,66,0.12)",
        },
        components: {
          Menu: {
            darkItemBg: "transparent",
            darkItemSelectedBg: "rgba(15,139,135,0.22)",
            darkItemSelectedColor: "#7FD6D2",
            darkItemHoverBg: "rgba(255,255,255,0.08)",
            itemBorderRadius: 8,
            itemHeight: 34,
          },
          Table: {
            headerBg: "#F5F6F6",
            headerColor: "#626C78",
            rowHoverBg: "#FAFBFB",
            borderColor: "#F3F4F4",
            cellPaddingBlock: 11,
            cellPaddingInline: 12,
          },
          Card: {
            padding: 16,
            paddingLG: 18,
          },
          Modal: {
            titleFontSize: 15,
          },
          Button: {
            defaultBorderColor: "#E1E3E3",
            defaultColor: "#383E42",
            primaryShadow: "none",
            fontWeight: 600,
          },
          Segmented: {
            itemSelectedBg: "#FFFFFF",
            trackBg: "#EFF1F1",
          },
          Tag: {
            defaultBg: "#EFF1F1",
            defaultColor: "#47515D",
          },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
