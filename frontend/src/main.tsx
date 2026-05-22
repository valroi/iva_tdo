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
          colorPrimary: "#1677ff",
          colorBgContainer: "#ffffff",
          colorBgElevated: "#ffffff",
          colorBgLayout: "#f5f5f5",
          colorBorder: "#e8e8e8",
          colorBorderSecondary: "#f0f0f0",
          colorTextBase: "#171717",
          colorTextSecondary: "#737373",
          colorTextTertiary: "#a3a3a3",
          borderRadius: 6,
          borderRadiusLG: 12,
          borderRadiusSM: 4,
          fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 13,
          fontSizeLG: 14,
          lineHeight: 1.5714,
          controlHeight: 32,
          controlHeightSM: 26,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          boxShadowSecondary: "0 4px 12px rgba(0,0,0,0.10)",
        },
        components: {
          Menu: {
            darkItemBg: "transparent",
            darkItemSelectedBg: "rgba(22,119,255,0.18)",
            darkItemSelectedColor: "#60a5fa",
            darkItemHoverBg: "rgba(255,255,255,0.07)",
            itemBorderRadius: 6,
          },
          Table: {
            headerBg: "#fafafa",
            headerColor: "#737373",
            rowHoverBg: "#f0f7ff",
            borderColor: "#e8e8e8",
            cellPaddingBlock: 9,
            cellPaddingInline: 12,
          },
          Card: {
            padding: 14,
            paddingLG: 16,
          },
          Modal: {
            titleFontSize: 14,
          },
          Button: {
            defaultBorderColor: "#c0c0c0",
            defaultColor: "#171717",
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
