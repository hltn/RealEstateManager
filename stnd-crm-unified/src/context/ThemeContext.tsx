"use client";

import type React from "react";
import { createContext, useState, useContext, useEffect } from "react";

type Theme = "light" | "dark";

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "theme";
const DEFAULT_THEME: Theme = "light";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Đọc theme người dùng đã chọn; giá trị thiếu/lạ → theme mặc định (light). */
function readStoredTheme(): Theme {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Đọc ngay lúc khởi tạo (không đợi effect) để không nháy sai theme khi nạp trang.
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Chỉ lưu khi người dùng chủ động đổi: người chưa chọn luôn theo mặc định hiện hành.
  const toggleTheme = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Bỏ qua: storage bị chặn thì chỉ mất ghi nhớ, theme vẫn đổi trong phiên.
    }
    setTheme(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
