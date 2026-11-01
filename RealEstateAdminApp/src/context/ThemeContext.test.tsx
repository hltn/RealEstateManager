import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it.each([
    ["chuỗi rỗng", ""],
    ["chuỗi JSON", JSON.stringify({ theme: "dark" })],
    ['JSON có nháy kép ("dark" kèm dấu nháy)', JSON.stringify("dark")],
    ["sai hoa/thường", "Dark"],
    ["có khoảng trắng thừa", " dark "],
  ])("giá trị lưu rác (%s) → quay về light, không gắn lớp dark", (_name, raw) => {
    localStorage.setItem("theme", raw);
    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
  });

  it("localStorage 'dark' → ngay lần render đầu đã là dark (không qua light rồi mới sang dark)", () => {
    localStorage.setItem("theme", "dark");
    const rendered: string[] = [];
    function RecordingProbe() {
      const { theme } = useTheme();
      rendered.push(theme);
      return null;
    }

    render(
      <ThemeProvider>
        <RecordingProbe />
      </ThemeProvider>,
    );

    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.every((value) => value === "dark")).toBe(true);
  });

  it("localStorage.getItem ném lỗi (storage bị chặn) → vẫn render, theme light, không crash", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(() => renderProvider()).not.toThrow();
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
  });

  it("localStorage.setItem ném lỗi khi toggle → theme và lớp dark vẫn đổi, không lỗi chưa bắt", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    renderProvider();

    expect(() =>
      act(() => screen.getByRole("button", { name: "toggle" }).click()),
    ).not.toThrow();
    expect(setItemSpy).toHaveBeenCalledWith("theme", "dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(isDarkClassOn()).toBe(true);

    expect(() =>
      act(() => screen.getByRole("button", { name: "toggle" }).click()),
    ).not.toThrow();
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isDarkClassOn()).toBe(false);
  });

  describe("dưới <StrictMode>", () => {
    const renderStrict = () =>
      render(
        <StrictMode>
          <ThemeProvider>
            <ThemeProbe />
          </ThemeProvider>
        </StrictMode>,
      );

    it("chưa toggle → không ghi localStorage, không gắn lớp dark", () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      renderStrict();

      expect(screen.getByTestId("theme")).toHaveTextContent("light");
      expect(isDarkClassOn()).toBe(false);
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem("theme")).toBeNull();
    });

    it("lưu 'dark' → sau double-invoke effect lớp dark vẫn bật, không ghi lại storage", () => {
      localStorage.setItem("theme", "dark");
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      renderStrict();

      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(isDarkClassOn()).toBe(true);
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it("toggle → ghi đúng một lần với giá trị mới, lớp dark khớp theme", () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      renderStrict();

      act(() => screen.getByRole("button", { name: "toggle" }).click());
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(isDarkClassOn()).toBe(true);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(setItemSpy).toHaveBeenCalledWith("theme", "dark");
    });
  });
});
