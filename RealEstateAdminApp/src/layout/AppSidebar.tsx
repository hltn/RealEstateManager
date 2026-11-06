import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Logo from "../images/logo/logo.png";

// Assume these icons are imported from an icon library
import {
  CalenderIcon,
  ChevronDownIcon,
  HorizontaLDots,
  ListIcon,
  PieChartIcon,
  PlugInIcon,
  TableIcon,
  UserCircleIcon,
  UserIcon,
  DocsIcon,
  FileIcon,
  GroupIcon,
  CloseIcon,
} from "../icons";
// [Prototype] Submenu module Quản lý khách hàng (CRM)
import { CRM_FEATURE_FLAGS } from "@crm/config/featureFlags";
import { CRM_MENU_NAME, useCrmSidebarSubItems, withCrmMenu } from "@crm/navigation";
import { CRM_BASE_PATH } from "@crm/routes";
import { BELOW_LG_MEDIA_QUERY } from "@crm/hooks/breakpoints";
import { useMediaQuery } from "@crm/hooks/useMediaQuery";

const ChevronDownIconAny = ChevronDownIcon as any;
const HorizontaLDotsAny = HorizontaLDots as any;
const CloseIconAny = CloseIcon as any;

import { useSidebar } from "../context/SidebarContext";
import SidebarWidget from "./SidebarWidget";
import { useAuth } from "../hooks/useAuth";
import { hasAnyRole, hasCrmRole, isCrmOnlyAccount } from "../utils/userRoles";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

const navItems: NavItem[] = [
  // [Prototype] Module CRM — mục đầu menu, submenu trỏ các route /crm/*
  {
    icon: <GroupIcon />,
    name: "Quản lý khách hàng",
    // Mục con CRM tính theo vai trò người dùng CRM hiện tại (xem `mainItems` trong component).
    subItems: [],
  },
  {
    icon: <ListIcon />,
    name: "Raw Articles",
    path: "/",
  },
  {
    icon: <TableIcon />,
    name: "Manage WP",
    path: "/manage-wp",
  },
  {
    icon: <PieChartIcon />,
    name: "Phân tích thị trường",
    path: "/market-analysis-workflow",
  },
  {
    icon: <UserCircleIcon />,
    name: "Sources",
    path: "/sources",
  },
];

const othersItems: NavItem[] = [];

/** AI Prompt Config được cả ADMIN và EDITOR sử dụng. */
const promptConfigItems: NavItem[] = [
  {
    icon: <DocsIcon />,
    name: "AI Prompt Config",
    path: "/ai-prompt-config",
  },
];

const adminItems: NavItem[] = [
  {
    icon: <PlugInIcon />,
    name: "AI Config",
    path: "/ai-config",
  },
  {
    icon: <FileIcon />,
    name: "Knowledge Articles",
    subItems: [
      { name: "Articles", path: "/knowledge-articles" },
      { name: "Config", path: "/knowledge-config" },
      { name: "Cron & Logs", path: "/knowledge-cron" },
    ],
  },
  {
    icon: <DocsIcon />,
    name: "Request Logs",
    path: "/external-logs",
  },
  {
    icon: <CalenderIcon />,
    name: "Cronjob",
    path: "/cronjob",
  },
  {
    icon: <UserIcon />,
    name: "Quản lý tài khoản",
    path: "/users",
  },
];

/** Selector nút hamburger ở `AppHeader` (đích dự phòng khi trả focus). */
const SIDEBAR_TOGGLE_SELECTOR = "[data-sidebar-toggle]";
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Danh sách phần tử focus được trong container theo thứ tự DOM (thứ tự Tab).
 * Bỏ phần tử nằm trong vùng `inert` (vd submenu đang đóng chỉ thu `height: 0`): chúng vô hình, không được làm mốc đầu/cuối của focus trap.
 * Dùng `closest('[inert]')` thay vì `offsetParent` vì kiểm được trong jsdom (không có layout).
 */
const getFocusableElements = (container: HTMLElement | null): HTMLElement[] =>
  container
    ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => !element.closest("[inert]"))
    : [];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered, closeMobileSidebar } = useSidebar();
  const location = useLocation();
  const { user } = useAuth();
  // FR-45: dưới `lg` sidebar là ngăn kéo trượt ra ngoài màn hình (-translate-x-full). Khi đóng phải ra khỏi thứ tự Tab
  // và cây truy cập (inert + aria-hidden); từ `lg` trở lên sidebar luôn hiện nên không được khóa.
  const isBelowLg = useMediaQuery(BELOW_LG_MEDIA_QUERY, false);
  const isDrawerClosed = isBelowLg && !isMobileOpen;
  const isAdmin = hasAnyRole(user, ["ADMIN"]);
  // [Prototype] Submenu CRM ẩn mục không đủ quyền (Báo cáo: Quản lý/Quản trị; Dự án, Cài đặt: Quản trị).
  const crmSubItems = useCrmSidebarSubItems();
  // MANAGER/STAFF chỉ dùng CRM; EDITOR không có quyền CRM (backend 403) -> ẩn mục tương ứng (UX; backend mới là nguồn sự thật).
  // Quyền là HỢP của mọi role: STAFF+EDITOR thấy cả CRM lẫn tin tức; chỉ khi KHÔNG có role nào của phía kia mới ẩn.
  const isCrmOnlyRole = isCrmOnlyAccount(user);
  const isEditor = hasAnyRole(user, ["EDITOR"]) && !hasCrmRole(user);
  const mainItems = useMemo(
    () =>
      withCrmMenu(navItems, crmSubItems, CRM_FEATURE_FLAGS.isPrototypeEnabled).filter((item) =>
        isCrmOnlyRole ? item.name === CRM_MENU_NAME : isEditor ? item.name !== CRM_MENU_NAME : true,
      ),
    [crmSubItems, isCrmOnlyRole, isEditor],
  );
  const canManagePrompts = hasAnyRole(user, ["ADMIN", "EDITOR"]);

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // const isActive = (path: string) => location.pathname === path;
  // [Prototype] Hỗ trợ submenu CRM: route con /crm/customers/:id cũng sáng mục /crm/customers
  const isActive = useCallback(
    (path: string) => {
      if (location.pathname === path) return true;
      // CRM submenu: sáng cả khi ở màn con (vd /crm/customers/:id -> /crm/customers)
      if (path.startsWith(CRM_BASE_PATH)) {
        return location.pathname.startsWith(path);
      }
      return false;
    },
    [location.pathname]
  );

  // PT-025: sidebar mobile tự đóng khi ĐỔI route (kể cả chọn mục con hay điều hướng bằng code).
  // Chỉ phản ứng khi pathname thật sự đổi (ref lưu pathname trước) để việc mở menu không tự đóng ngay;
  // Dùng `closeMobileSidebar` (đóng tường minh, không đảo trạng thái) nên không bao giờ vô tình mở lại sidebar đã đóng.
  const previousPathnameRef = useRef(location.pathname);
  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) return;
    previousPathnameRef.current = location.pathname;
    if (isMobileOpen) closeMobileSidebar();
  }, [location.pathname, isMobileOpen, closeMobileSidebar]);

  // Chạm lại mục của CHÍNH route đang đứng thì route không đổi (effect trên không chạy) -> đóng tại chỗ.
  const handleNavigate = (path: string) => {
    if (isMobileOpen && path === location.pathname) closeMobileSidebar();
  };

  const drawerRef = useRef<HTMLElement>(null);
  const isDrawerOpen = isBelowLg && isMobileOpen;

  // T-71 (1)+(2): khi ngăn kéo mở, nhớ phần tử đang giữ focus (nút hamburger đã mở nó; Safari iOS không focus nút khi chạm
  // nên dự phòng bằng `[data-sidebar-toggle]`) rồi chuyển focus vào phần tử focus được đầu tiên trong ngăn kéo.
  // Khi đóng (Esc, backdrop, nút X, đổi route) hoặc unmount thì cleanup trả focus về nút đó.
  useEffect(() => {
    if (!isDrawerOpen) return undefined;
    const panel = drawerRef.current;
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement && active !== document.body && !panel?.contains(active)
        ? active
        : document.querySelector<HTMLElement>(SIDEBAR_TOGGLE_SELECTOR);
    getFocusableElements(panel)[0]?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [isDrawerOpen]);

  // FR-45 (T-58) + T-71: Esc đóng ngăn kéo, Tab/Shift+Tab xoay vòng trong ngăn kéo (focus trap).
  // Listener chỉ tồn tại khi ngăn kéo đang mở dưới `lg`; đóng, lên desktop hoặc unmount thì cleanup gỡ ngay.
  useEffect(() => {
    if (!isDrawerOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // T-71 (4): thành phần khác (dropdown/modal) đã xử lý Esc thì không đóng đồng thời ngăn kéo.
        if (event.defaultPrevented) return;
        closeMobileSidebar();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getFocusableElements(drawerRef.current);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const isInside = active instanceof Node && drawerRef.current?.contains(active) === true;
      // Ở mép (hoặc đã lạc ra ngoài ngăn kéo): quay vòng thay vì để trình duyệt đưa focus ra nội dung phía sau backdrop.
      if (event.shiftKey && (!isInside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!isInside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, closeMobileSidebar]);

  useEffect(() => {
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? mainItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
  }, [location, isActive, mainItems]);

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={`menu-item-icon-size  ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIconAny
                  className={`ml-auto w-5 h-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                to={nav.path}
                onClick={() => handleNavigate(nav.path as string)}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`menu-item-icon-size ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className="menu-item-text">{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              // Submenu đóng chỉ thu chiều cao nên link vẫn Tab tới được: `inert` đưa chúng ra khỏi thứ tự Tab và cây truy cập.
              inert={!(openSubmenu?.type === menuType && openSubmenu?.index === index)}
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      to={subItem.path}
                      onClick={() => handleNavigate(subItem.path)}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            new
                          </span>
                        )}
                        {subItem.pro && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    // PT-024: neo top-0 + bottom-0 (inset-y-0) và h-dvh để panel phủ kín từ mép trên tới mép dưới
    // THẤY ĐƯỢC của màn hình, co giãn theo thanh địa chỉ Safari (dvh); trước đây `mt-16` chừa 64px cho header
    // nên hở khoảng trống phía trên. Chừa `env(safe-area-inset-*)` cho tai thỏ / thanh home iOS (desktop lg: bỏ).
    <aside
      ref={drawerRef}
      className={`fixed inset-y-0 left-0 h-dvh flex flex-col px-5 pl-[max(1.25rem,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:pt-0 lg:pb-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      inert={isDrawerClosed}
      aria-hidden={isDrawerClosed ? true : undefined}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* PT-025: nút X nằm TRONG vùng nền trắng của panel, góc phải (không còn ở vùng nền tối bên trái); chỉ mobile. */}
      <button
        type="button"
        onClick={closeMobileSidebar}
        aria-label="Đóng menu"
        className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
      >
        <CloseIconAny className="size-6" />
      </button>
      <div className="py-8 flex justify-center">
        <Link to="/" onClick={() => handleNavigate("/")}>
          {isExpanded || isHovered || isMobileOpen ? (
            <>
              <img
                className="dark:hidden"
                src={Logo}
                alt="Logo"
                width={60}
              />
              <img
                className="hidden dark:block"
                src={Logo}
                alt="Logo"
                width={60}
              />
            </>
          ) : (
            <img
              src={Logo}
              alt="Logo"
              width={32}
            />
          )}
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Menu"
                ) : (
                  <HorizontaLDotsAny className="size-6" />
                )}
              </h2>
              {renderMenuItems(mainItems, "main")}
              {canManagePrompts && (
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                  {renderMenuItems(promptConfigItems, "main")}
                </div>
              )}
              {isAdmin && (
                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                  {renderMenuItems(adminItems, "main")}
                </div>
              )}
            </div>
          </div>
        </nav>
        {isExpanded || isHovered || isMobileOpen ? <SidebarWidget /> : null}
      </div>
    </aside>
  );
};

export default AppSidebar;
