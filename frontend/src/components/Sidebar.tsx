import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  Database, Plus, FolderOpen, MessageSquare, 
  LayoutDashboard, Settings, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen,
  Sparkles, Crown, Clock, CreditCard, ShieldCheck, Zap,
  MoreHorizontal, Pencil, Trash2, Check, X, Loader2
} from "lucide-react";
import { motion } from "framer-motion";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "../lib/utils";
import { useStore } from "../store/useStore";
import { api } from "../lib/api";
import { formatResetTime } from "../lib/formatters";
import ConfirmDialog from "./ConfirmDialog";

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  onNewResearch: () => void;
  conversationsCount: number;
  onSelectSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onRenameSession?: (id: string, newName: string) => void;
}

const PAGE_SIZE = 10;

export default function Sidebar({
  currentTab,
  setCurrentTab,
  onNewResearch,
  conversationsCount,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}: SidebarProps) {
  const queryClient = useQueryClient();
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const user = useStore((s) => s.user);
  const quota = useStore((s) => s.quota);
  const setQuota = useStore((s) => s.setQuota);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const activeConvId = useStore((s) => s.activeConvId);
  const setActiveConvId = useStore((s) => s.setActiveConvId);
  const conversations = useStore((s) => s.conversations);
  const streamingSessions = useStore((s) => s.streamingSessions);

  const logout = () => {
    api.logout();
  };

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEdgeHovering, setIsEdgeHovering] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Recents chat list states
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    api.getQuota()
      .then((q) => {
        if (isMounted) setQuota(q);
      })
      .catch(() => {
        // Fallback gracefully if quota endpoint fails
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, setQuota]);

  // Click outside to close user dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Click outside to close three-dots action dropdown
  useEffect(() => {
    function handleClickOutsideActions(event: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setActiveMenuSessionId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutsideActions);
    return () => document.removeEventListener("mousedown", handleClickOutsideActions);
  }, []);

  // TanStack Infinite Query for paginated sessions (10 per batch)
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["sidebar-sessions"],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await api.getSessions(PAGE_SIZE, pageParam);
      return {
        sessions: (res.sessions || []) as Array<{
          session_id: string;
          title: string;
          updated_at?: string;
        }>,
        hasMore: Boolean(res.has_more),
        nextOffset: pageParam + (res.sessions?.length || 0),
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
    enabled: isAuthenticated,
    staleTime: 1000 * 30,
  });

  const fetchedSessions = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.sessions);
  }, [data]);

  // Flattened reverse chronological list: NO date headers (ChatGPT style)
  // Deduplicates by session_id while preserving backend/optimistic recency order
  const sessionsList = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; title: string }> = [];

    for (const s of fetchedSessions) {
      if (!s.session_id || seen.has(s.session_id)) continue;
      seen.add(s.session_id);
      const storeMatch = conversations.find((c) => c.id === s.session_id);
      result.push({
        id: s.session_id,
        title: storeMatch?.title || s.title || "New Chat",
      });
    }

    return result;
  }, [fetchedSessions, conversations]);

  // Infinite scroll trigger via IntersectionObserver
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "60px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleSelectChat = (id: string) => {
    if (onSelectSession) {
      onSelectSession(id);
    } else {
      setActiveConvId(id);
    }
    setCurrentTab("conversations");
  };

  const handleStartRename = (id: string, currentTitle: string) => {
    setEditingSessionId(id);
    setEditingTitle(currentTitle);
    setActiveMenuSessionId(null);
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      if (onRenameSession) {
        onRenameSession(id, trimmed);
      } else {
        api.renameSession(id, trimmed).catch(() => {});
      }
      queryClient.setQueryData(["sidebar-sessions"], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((p: any) => ({
            ...p,
            sessions: p.sessions.map((s: any) =>
              s.session_id === id ? { ...s, title: trimmed } : s
            ),
          })),
        };
      });
    }
    setEditingSessionId(null);
  };

  const handleConfirmDelete = () => {
    if (!sessionToDelete) return;
    const id = sessionToDelete;
    if (onDeleteSession) {
      onDeleteSession(id);
    } else {
      api.deleteSession(id).catch(() => {});
    }

    queryClient.setQueryData(["sidebar-sessions"], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((p: any) => ({
          ...p,
          sessions: p.sessions.filter((s: any) => s.session_id !== id),
        })),
      };
    });

    if (activeConvId === id) {
      setActiveConvId(null);
    }
    setSessionToDelete(null);
  };

  const isAdmin = user?.role?.toLowerCase() === "admin";
  const isPro = user?.role?.toLowerCase() === "pro";

  const navTabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "D" },
    { id: "documents", label: "Documents", icon: FolderOpen, shortcut: "U" },
    { id: "settings", label: "Settings", icon: Settings, shortcut: "S" },
    ...(isAdmin ? [{ id: "admin", label: "Admin", icon: ShieldCheck, shortcut: "A" }] : []),
  ];

  return (
    <>
      <aside
        id="rag-sidebar"
        onMouseEnter={() => isCollapsed && setIsEdgeHovering(true)}
        onMouseLeave={() => setIsEdgeHovering(false)}
        className={cn(
          "group/sidebar relative hidden md:flex h-full flex-col border-r border-border select-none overflow-visible bg-surface-container-lowest dark:bg-transparent transition-colors duration-200",
          isCollapsed ? "w-16 px-2 py-4 justify-between" : "w-[260px] p-4 justify-between"
        )}
      >
        {/* Top Header & Navigation Section */}
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
          {/* Brand Logo & Header */}
          <div className={cn("flex items-center mb-3 shrink-0", isCollapsed ? "justify-center" : "space-x-3 px-1")}>
            {isCollapsed ? (
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className={cn(
                  "group/sidebar-toggle relative flex h-10 w-10 items-center justify-center rounded-xl border shadow-premium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer",
                  isEdgeHovering
                    ? "border-border bg-surface text-muted-foreground"
                    : "border-transparent bg-primary text-on-primary-container hover:bg-surface-container-high hover:text-foreground"
                )}
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <Database
                  className={cn(
                    "absolute h-4 w-4 transition-opacity transition-transform duration-150 motion-reduce:transition-none group-hover/sidebar-toggle:scale-75 group-hover/sidebar-toggle:opacity-0",
                    isEdgeHovering && "scale-75 opacity-0"
                  )}
                />
                <PanelLeftOpen
                  className={cn(
                    "absolute h-4 w-4 scale-75 opacity-0 transition-opacity transition-transform duration-150 motion-reduce:transition-none group-hover/sidebar-toggle:scale-100 group-hover/sidebar-toggle:opacity-100",
                    isEdgeHovering && "scale-100 opacity-100"
                  )}
                />
              </button>
            ) : (
              <>
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary-container shadow-premium shrink-0">
                  <Database className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-base font-bold text-on-surface tracking-tight leading-tight truncate">
                    KnowVex
                  </h1>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCollapsed(true)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-surface-container-high hover:text-foreground active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {/* Primary CTA Button: New Chat */}
          <button
            type="button"
            id="btn-new-research"
            onClick={onNewResearch}
            className={cn(
              "bg-surface border border-border hover:bg-surface-container-high text-on-surface font-medium text-xs flex items-center cursor-pointer shadow-premium transition-colors duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary shrink-0 mb-3",
              isCollapsed ? "h-10 w-10 justify-center self-center rounded-xl p-0" : "w-full rounded-lg py-2 px-3 justify-between"
            )}
            title="New Chat"
            aria-label="New Chat"
          >
            <span className={cn("flex items-center", !isCollapsed && "space-x-2")}>
              <Plus className="w-4 h-4 text-muted-foreground" />
              {!isCollapsed && <span>New Chat</span>}
            </span>
            {!isCollapsed && (
              <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                ⌘K
              </span>
            )}
          </button>

          {/* Collapsed Rail Nav */}
          {isCollapsed ? (
            <div className="space-y-1 shrink-0">
              <button
                type="button"
                onClick={() => setCurrentTab("dashboard")}
                className={cn(
                  "mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-xs transition-colors cursor-pointer",
                  currentTab === "dashboard"
                    ? "bg-surface-container-high text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-surface-container hover:text-foreground font-medium"
                )}
                title="Dashboard"
              >
                <LayoutDashboard className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className={cn(
                  "relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-xs transition-colors cursor-pointer",
                  currentTab === "conversations" || currentTab === "chats"
                    ? "bg-surface-container-high text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-surface-container hover:text-foreground font-medium"
                )}
                title="Chats (Click to expand)"
              >
                <MessageSquare className="w-4 h-4" />
                {Object.keys(streamingSessions).length > 0 ? (
                  <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-primary animate-ping" title="Response generating..." />
                ) : conversationsCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setCurrentTab("documents")}
                className={cn(
                  "mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-xs transition-colors cursor-pointer",
                  currentTab === "documents"
                    ? "bg-surface-container-high text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-surface-container hover:text-foreground font-medium"
                )}
                title="Documents"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentTab("settings")}
                className={cn(
                  "mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-xs transition-colors cursor-pointer",
                  currentTab === "settings"
                    ? "bg-surface-container-high text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-surface-container hover:text-foreground font-medium"
                )}
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setCurrentTab("admin")}
                  className={cn(
                    "mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-xs transition-colors cursor-pointer",
                    currentTab === "admin"
                      ? "bg-surface-container-high text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-surface-container hover:text-foreground font-medium"
                  )}
                  title="Admin"
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Compact Top Navigation Links */}
              <nav className="space-y-0.5 shrink-0 mb-3">
                {navTabs.map((item) => {
                  const isActive = currentTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCurrentTab(item.id)}
                      className={cn(
                        "relative flex items-center w-full rounded-md px-2.5 py-1.5 text-xs tracking-tight transition-colors duration-150 cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                        isActive
                          ? "text-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface-container/50 font-medium"
                      )}
                      title={item.label}
                      aria-label={item.label}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="sidebar-active-indicator"
                          className="absolute inset-0 bg-surface-container-high rounded-md"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                      <item.icon
                        className={cn(
                          "relative z-10 w-3.5 h-3.5 mr-2.5 transition-colors",
                          isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                        )}
                      />
                      <span className="relative z-10">{item.label}</span>
                      {item.shortcut && (
                        <span className="relative z-10 ml-auto text-[10px] font-mono text-muted-foreground border border-border rounded px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Recents Section (ChatGPT Style: Flat reverse chronological order with infinite scroll) */}
              <div className="flex-1 min-h-0 flex flex-col pt-2 border-t border-border/50">
                <div className="flex items-center justify-between px-2 mb-1.5 shrink-0">
                  <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Recents
                  </span>
                  {isFetchingNextPage && (
                    <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                  )}
                </div>

                {/* Scrollable Container with Infinite Scroll */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1 -mr-1">
                  {isLoading && sessionsList.length === 0 ? (
                    <div className="space-y-1.5 px-1 py-1">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-7 rounded-lg bg-surface-container/50 animate-pulse" />
                      ))}
                    </div>
                  ) : sessionsList.length === 0 ? (
                    <div className="px-2 py-6 text-center">
                      <p className="text-xs text-muted-foreground/80 font-normal">No chats yet</p>
                    </div>
                  ) : (
                    sessionsList.map((session) => {
                      const isActive =
                        activeConvId === session.id &&
                        (currentTab === "conversations" || currentTab === "chats");
                      const isRenaming = editingSessionId === session.id;
                      const isMenuOpen = activeMenuSessionId === session.id;

                      if (isRenaming) {
                        return (
                          <div
                            key={session.id}
                            className="flex items-center space-x-1 px-2 py-1 bg-surface-container rounded-lg border border-border"
                          >
                            <input
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveRename(session.id);
                                if (e.key === "Escape") setEditingSessionId(null);
                              }}
                              autoFocus
                              className="flex-1 min-w-0 bg-transparent text-xs text-foreground font-medium outline-none px-1 py-0.5 border-b border-primary"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(session.id)}
                              className="p-1 rounded hover:bg-surface-container-high text-success transition-colors cursor-pointer"
                              title="Save"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSessionId(null)}
                              className="p-1 rounded hover:bg-surface-container-high text-muted-foreground transition-colors cursor-pointer"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      }

                      const isStreaming = Boolean(streamingSessions[session.id]);

                      return (
                        <div
                          key={session.id}
                          onClick={() => handleSelectChat(session.id)}
                          className={cn(
                            "group relative flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 cursor-pointer select-none",
                            isActive
                              ? "bg-surface-container-high text-foreground font-semibold shadow-xs"
                              : "text-muted-foreground hover:text-foreground hover:bg-surface-container/60 font-medium"
                          )}
                        >
                          <span className="truncate flex-1 min-w-0 text-left pr-1" title={session.title}>
                            {session.title}
                          </span>

                          {/* Glowing animated ping dot if generating in background or active (Decision 2 - Option A) */}
                          {isStreaming && (
                            <span className="relative flex h-2 w-2 shrink-0 mr-1.5" title="Generating response...">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                            </span>
                          )}

                          {/* Hover Three-Dots Menu (ChatGPT style) */}
                          <div
                            className="relative shrink-0 flex items-center"
                            ref={isMenuOpen ? actionMenuRef : undefined}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuSessionId(isMenuOpen ? null : session.id);
                              }}
                              className={cn(
                                "p-1 rounded-md transition-opacity duration-150 text-muted-foreground hover:text-foreground hover:bg-surface-container-highest cursor-pointer",
                                isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                              )}
                              title="Chat options"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>

                            {/* Dropdown Menu */}
                            {isMenuOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-full mt-1 w-32 bg-surface border border-border rounded-lg shadow-lg py-1 z-50 animate-in fade-in zoom-in-95 duration-150"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleStartRename(session.id, session.title)}
                                  className="w-full flex items-center px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-container transition-colors cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuSessionId(null);
                                    setSessionToDelete(session.id);
                                  }}
                                  className="w-full flex items-center px-2.5 py-1.5 text-xs text-danger hover:bg-danger-subtle transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Sentinel element to trigger infinite scroll loading */}
                  <div ref={sentinelRef} className="h-4 w-full shrink-0" />

                  {/* Loading indicator when fetching next batch */}
                  {isFetchingNextPage && (
                    <div className="py-1.5 flex justify-center items-center">
                      <Loader2 className="w-3.5 h-3.5 text-muted-foreground/60 animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Profile & Logout */}
        <div className={cn("relative shrink-0 pt-2", isCollapsed ? "space-y-1" : "space-y-1")} ref={menuRef}>
          {/* Collapsed mode: theme + logout icons above avatar */}
          {isCollapsed && (
            <>
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-container hover:text-foreground transition-colors cursor-pointer"
                title="Toggle Theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={logout}
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-danger-subtle hover:text-danger transition-colors cursor-pointer"
                title="Log Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Dropdown Menu (expanded mode) */}
          {showUserMenu && !isCollapsed && (
            <div className="absolute bottom-full left-1 right-1 mb-2 bg-surface border border-border rounded-xl overflow-hidden z-50 shadow-xl">
              {/* Plan Info Strip */}
              <div 
                onClick={() => {
                  localStorage.setItem("settings_active_section", "subscription");
                  setCurrentTab("settings");
                  setShowUserMenu(false);
                }}
                className={cn(
                  "px-3.5 py-2.5 border-b flex items-center justify-between cursor-pointer transition-all group relative overflow-hidden",
                  isPro
                    ? "bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-amber-500/5 border-amber-500/30 shadow-[inset_0_0_15px_rgba(245,158,11,0.08)] hover:from-amber-500/20 hover:border-amber-500/40"
                    : "bg-surface-container/50 border-border/60 hover:bg-surface-container"
                )}
              >
                {isPro && (
                  <div className="absolute -top-6 -right-6 w-16 h-16 bg-amber-400/15 rounded-full blur-xl pointer-events-none" />
                )}
                <div className="relative z-10">
                  <p className={cn(
                    "text-xs font-bold transition-colors flex items-center gap-1.5",
                    isPro ? "text-amber-700 dark:text-amber-300" : "text-foreground group-hover:text-primary"
                  )}>
                    {isPro && <Crown className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />}
                    {isPro ? "KnowVex Pro — Active" : "Current plan"}
                  </p>
                  <p className={cn("text-[11px]", isPro ? "text-amber-800/90 dark:text-amber-200/80 font-medium" : "text-muted-foreground")}>
                    {isAdmin ? "System Administrator" : isPro ? "Priority agents & research tier" : "Community Free"}
                  </p>
                </div>
                <div className="relative z-10">
                  {isPro ? (
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-neutral-950 inline-flex items-center gap-1 shadow-[0_0_12px_rgba(245,158,11,0.35)] tracking-wide">
                      <Crown className="w-2.5 h-2.5 fill-neutral-950 text-neutral-950" />
                      PRO
                    </span>
                  ) : (
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded border inline-flex items-center gap-1",
                      isAdmin ? "bg-primary/10 text-primary border-primary/20" : "bg-surface-container text-muted-foreground border-border"
                    )}>
                      {isAdmin ? "Admin" : "Free"}
                    </span>
                  )}
                </div>
              </div>

              {/* Daily Quota Progress */}
              <div className="px-3.5 py-2.5 bg-surface/50 border-b border-border/60">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                    {isPro ? (
                      <Zap className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-primary" />
                    )}
                    Daily queries
                  </span>
                  <span className="tabular-nums font-medium text-foreground text-xs">
                    {quota ? (quota.query_limit === null ? "Unlimited" : `${quota.queries_used} / ${quota.query_limit}`) : "..."}
                  </span>
                </div>
                {quota && quota.query_limit !== null ? (
                  <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none",
                        quota.queries_used >= quota.query_limit
                          ? "bg-danger"
                          : quota.queries_used / quota.query_limit > 0.8
                          ? "bg-warning"
                          : isPro
                          ? "bg-gradient-to-r from-amber-400 to-yellow-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                          : "bg-primary"
                      )}
                      style={{ transform: `scaleX(${Math.min(1, quota.queries_used / quota.query_limit)})`, width: "100%" }}
                    />
                  </div>
                ) : (
                  <div className={cn("text-xs font-semibold", isPro ? "text-amber-600 dark:text-amber-400" : "text-primary/80")}>
                    Full unmetered access
                  </div>
                )}
              </div>

              {/* Deep Research Quota Progress */}
              <div className="px-3.5 py-2.5 bg-surface/30 border-b border-border/60">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                    {isPro ? (
                      <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                    ) : null}
                    Deep research
                  </span>
                  <span className="tabular-nums font-medium text-foreground text-xs">
                    {quota ? (quota.research_limit === null ? "Unlimited" : `${quota.research_used ?? 0} / ${quota.research_limit}`) : "..."}
                  </span>
                </div>
                {quota && quota.research_limit !== null ? (
                  <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none",
                        (quota.research_used ?? 0) >= quota.research_limit
                          ? "bg-danger"
                          : (quota.research_used ?? 0) / quota.research_limit >= 0.8
                          ? "bg-warning"
                          : isPro
                          ? "bg-gradient-to-r from-amber-400 to-yellow-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                          : "bg-success"
                      )}
                      style={{ transform: `scaleX(${Math.min(1, (quota.research_used ?? 0) / quota.research_limit)})`, width: "100%" }}
                    />
                  </div>
                ) : (
                  <div className="text-xs text-success">
                    Full unmetered research
                  </div>
                )}
              </div>

              {/* Daily Reset Time */}
              <div className="px-3.5 py-1.5 bg-surface/20 border-b border-border/60 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted-foreground/80" /> Daily reset
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatResetTime().summary}
                </span>
              </div>

              <div className="p-1.5 space-y-1">
                <button 
                  type="button"
                  onClick={() => { 
                    localStorage.setItem("settings_active_section", "subscription");
                    setCurrentTab("settings"); 
                    setShowUserMenu(false); 
                  }}
                  className="w-full flex items-center px-3 py-2 text-xs text-foreground font-medium hover:bg-surface-container rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <CreditCard className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  Subscription & Quota
                </button>
                <button 
                  type="button"
                  onClick={() => { 
                    localStorage.setItem("settings_active_section", "account");
                    setCurrentTab("settings"); 
                    setShowUserMenu(false); 
                  }}
                  className="w-full flex items-center px-3 py-2 text-xs text-foreground font-medium hover:bg-surface-container rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Settings className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  Account Settings
                </button>
                <button 
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center px-3 py-2 text-xs text-danger font-medium hover:bg-danger-subtle rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                >
                  <LogOut className="w-3.5 h-3.5 mr-2" />
                  Log Out
                </button>
              </div>
            </div>
          )}

          {/* User profile row */}
          <div className={cn("flex items-center py-1.5", isCollapsed ? "justify-center px-0" : "justify-between px-1")}>
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              aria-label="User menu"
              className={cn(
                "flex items-center rounded-lg hover:bg-surface-container-low transition-colors cursor-pointer border border-transparent hover:border-border/50 px-1 py-1 min-w-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                isCollapsed ? "justify-center" : "space-x-3 flex-1"
              )}
            >
              <div className="relative flex-shrink-0">
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ring-1 transition-all",
                  isPro
                    ? "bg-gradient-to-tr from-amber-500/20 via-yellow-500/25 to-amber-400/20 text-amber-700 dark:text-amber-300 ring-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.25)]"
                    : "bg-primary/20 text-primary ring-border"
                )}>
                  {user?.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                {isCollapsed && (isPro || isAdmin) && (
                  <span className={cn(
                    "absolute -top-0.5 -right-0.5 rounded-full ring-2 ring-background",
                    isPro ? "w-2.5 h-2.5 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.85)]" : "w-2 h-2 bg-warning"
                  )} />
                )}
              </div>
              {!isCollapsed && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-on-surface truncate leading-tight tracking-tight">
                      {user?.name || "User"}
                    </p>
                    {isPro ? (
                      <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-neutral-950 inline-flex items-center gap-0.5 shadow-[0_0_12px_rgba(245,158,11,0.35)] tracking-wide shrink-0">
                        <Crown className="w-2 h-2 fill-neutral-950 text-neutral-950" />
                        PRO
                      </span>
                    ) : (
                      <span className={cn(
                        "text-[9px] font-semibold px-1.5 py-0.2 rounded border inline-flex items-center gap-0.5 shrink-0",
                        isAdmin
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-surface-container-high text-muted-foreground border-border/60"
                      )}>
                        {isAdmin ? "Admin" : "Free"}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate block">{user?.email || "No email"}</span>
                </div>
              )}
            </button>
            {!isCollapsed && (
              <button 
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="p-1.5 text-muted-foreground hover:bg-surface-container hover:text-foreground rounded-md transition-colors cursor-pointer ml-1 flex-shrink-0"
                title="Toggle Theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Confirmation Dialog for Session Deletion */}
      <ConfirmDialog
        isOpen={!!sessionToDelete}
        title="Delete chat?"
        description="This will permanently delete this conversation and its history. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmClassName="bg-danger hover:bg-danger/90 text-white"
        onConfirm={handleConfirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />
    </>
  );
}
