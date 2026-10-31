import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

const isDarkClassOn = () =>
  document.documentElement.classList.contains("dark");

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("mặc định light, không gắn lớp dark và không ghi localStorage khi chưa chọn", () => {
    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("giá trị localStorage lạ/hỏng → quay về light", () => {
    localStorage.setItem("theme", "purple");
    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
  });

  it("localStorage 'dark' → giữ dark và gắn lớp dark lên <html>", () => {
    localStorage.setItem("theme", "dark");
    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(isDarkClassOn()).toBe(true);
  });

  it("localStorage 'light' → giữ light, không có lớp dark", () => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.add("dark"); // dư lớp từ trước phải được gỡ
    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
  });

  it("toggle: light → dark → light, cập nhật lớp dark và lưu localStorage", () => {
    renderProvider();

    act(() => screen.getByRole("button", { name: "toggle" }).click());
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(isDarkClassOn()).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    act(() => screen.getByRole("button", { name: "toggle" }).click());
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
