import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toast } from "sonner";
import { useStore } from "../store/useStore";
import { Message, Citation, SourceDocument, Conversation } from "../types";
import { mapSourcesToCitations, formatResetTime } from "../lib/formatters";

interface UseChatStreamProps {
  activeConvId: string | null;
  setActiveConvId: (id: string | null) => void;
  setConversations: (fn: (prev: Conversation[]) => Conversation[]) => void;
  documents: SourceDocument[];
  draftLinkedDocIds: string[];
  setDraftLinkedDocIds: (ids: string[]) => void;
  setCurrentTab: (tab: string) => void;
  setIsMobileSidebarOpen: (open: boolean) => void;
}

export function useChatStream({
  activeConvId,
  setActiveConvId,
  setConversations,
  documents,
  draftLinkedDocIds,
  setDraftLinkedDocIds,
  setCurrentTab,
  setIsMobileSidebarOpen,
}: UseChatStreamProps) {
  const queryClient = useQueryClient();
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const streamingSessions = useStore((s) => s.streamingSessions);
  const setSessionStream = useStore((s) => s.setSessionStream);
  const updateSessionStream = useStore((s) => s.updateSessionStream);

  // Sync historical messages for the active conversation from DB
  const { data: historyMessages } = useQuery({
    queryKey: ["sessionHistory", activeConvId],
    queryFn: async () => {
      if (!activeConvId) return [];
      const fetchHistory = api.getSessionHistory || (api as any).getSessionMessages;
      const data = await fetchHistory(activeConvId);
      const rawMessages = data.messages || [];

      return rawMessages.map((m: any, idx: number) => {
        const metadata = m.meta_data || {};
        const sources = m.citations || metadata.sources || [];
        const mappedSources = mapSourcesToCitations(sources);

        return {
          id: m.message_id ? String(m.message_id) : (m.id ? `db-${m.id}` : `msg-${m.created_at}-${idx}`),
          dbId: m.message_id || m.id || undefined,
          sender: m.role === "human" ? "user" : m.role || "assistant",
          text: m.content || "",
          timestamp: m.created_at || new Date().toISOString(),
          citations: mappedSources.length > 0 ? mappedSources : undefined,
          chunks: m.chunks || metadata.chunks || undefined,
        };
      });
    },
    enabled: !!activeConvId && isAuthenticated,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Re-hydrate active messages smoothly from persistent DB history + live background stream
  const activeStream = activeConvId ? streamingSessions[activeConvId] : undefined;

  const activeMessages = useMemo(() => {
    const base = historyMessages || [];
    if (!activeStream) return base;

    const msgs = [...base];
    const hasUserMsg = msgs.some(
      (m) =>
        m.id === activeStream.userMessage.id ||
        (m.sender === "user" && m.text === activeStream.userMessage.text)
    );
    if (!hasUserMsg) {
      msgs.push(activeStream.userMessage);
    }

    const botMsg: Message = {
      id: activeStream.botMsgId,
      dbId: activeStream.finalMessageId,
      sender: "assistant",
      text: activeStream.currentText,
      timestamp: activeStream.startedAt,
      citations: activeStream.citations.length > 0 ? activeStream.citations : undefined,
      chunks: activeStream.chunks,
      isProcessing: true,
    };
    msgs.push(botMsg);

    return msgs;
  }, [historyMessages, activeStream]);

  const graphStatuses = useMemo(() => {
    if (!activeStream) return [];
    return activeStream.graphStatuses || [];
  }, [activeStream]);

  const handleSendMessage = async (text: string, mode: "auto" | "research" = "auto") => {
    if (!text.trim()) return;

    let targetConvId = activeConvId;

    if (!targetConvId) {
      try {
        const createRes = await api.createSession();
        targetConvId = createRes.session_id;

        const words = text.trim().split(/\s+/);
        const title = words.length <= 6 ? text.trim() : words.slice(0, 6).join(" ") + "...";

        const newConv: Conversation = {
          id: targetConvId,
          title,
          timestamp: new Date().toISOString(),
          messages: [],
        };
        setConversations((prev) => [newConv, ...prev]);
        setActiveConvId(targetConvId);

        await api.renameSession(targetConvId, title);
        queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
        queryClient.invalidateQueries({ queryKey: ["sessions"] });

        const linkedDraftDocIds = [...draftLinkedDocIds];
        for (const docId of linkedDraftDocIds) {
          await api.linkDocumentToSession(targetConvId, docId);
        }
        if (linkedDraftDocIds.length > 0) {
          queryClient.setQueryData(
            ["sessionDocuments", targetConvId],
            documents.filter((doc) => linkedDraftDocIds.includes(doc.id))
          );
          queryClient.invalidateQueries({ queryKey: ["sessionDocuments", targetConvId] });
        }
        setDraftLinkedDocIds([]);
      } catch (err) {
        toast.error("Failed to initialize conversation session.");
        return;
      }
    }

    const finalConvId = targetConvId;

    // Concurrency Check: If THIS chat is already actively streaming, don't allow duplicate queries
    if (useStore.getState().streamingSessions[finalConvId]) {
      return;
    }

    const currentConv = useStore.getState().conversations.find((c) => c.id === finalConvId);
    const targetTitle = currentConv?.title || (text.length > 28 ? text.slice(0, 28) + "..." : text);

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      sender: "user",
      text,
      timestamp: new Date().toISOString(),
    };

    const botMsgId = `msg-${Date.now() + 1}`;
    const abortController = new AbortController();

    // Bump conversation timestamp in recents list
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === finalConvId) {
          return {
            ...conv,
            timestamp: new Date().toISOString(),
          };
        }
        return conv;
      })
    );

    // Register active stream in global store registry
    setSessionStream(finalConvId, {
      sessionId: finalConvId,
      botMsgId,
      userMessage: userMsg,
      currentText: "",
      graphStatuses: [{ node: "main_router", label: "Deciding route", status: "running" }],
      citations: [],
      sessionTitle: targetTitle,
      startedAt: new Date().toISOString(),
      abortController,
    });

    let currentText = "";
    let finalCitations: Citation[] = [];
    let finalChunks: any = undefined;
    let finalMessageId: number | undefined = undefined;

    try {
      const res = await api.streamChat(finalConvId, text, mode, abortController.signal);

      if (!res.ok || !res.body) {
        if (res.status === 429) {
          const errorData = await res.json().catch(() => null);
          const isResearchQuota =
            errorData?.detail?.error === "RESEARCH_QUOTA_EXCEEDED" ||
            errorData?.detail?.code === "RESEARCH_QUOTA_EXCEEDED" ||
            errorData?.error === "RESEARCH_QUOTA_EXCEEDED";
          const isDailyQuota =
            errorData?.detail?.error === "QUOTA_EXCEEDED" ||
            errorData?.error === "QUOTA_EXCEEDED";
          const resetInfo = formatResetTime();
          const isProUser = useStore.getState().user?.role?.toLowerCase() === "pro";
          const rateLimitMsg = isResearchQuota
            ? `**Deep Research Quota Exceeded** — ${errorData?.detail?.message || "You have reached your daily research allowance."} ${resetInfo.summary}.${isProUser ? "" : " Please upgrade to Pro for higher limits."}`
            : isDailyQuota
            ? `**Daily Query Quota Exceeded** — ${errorData?.detail?.message || "You have reached your daily query allowance."} ${resetInfo.summary}.${isProUser ? "" : " Please upgrade to Pro for 500 queries/day."}`
            : "**Rate Limited** — The AI provider is busy. Please wait a moment and try again.";
          currentText = rateLimitMsg;

          updateSessionStream(finalConvId, (prev) => ({
            ...prev,
            currentText: rateLimitMsg,
            graphStatuses: prev.graphStatuses.map((s) =>
              s.status === "running" ? { ...s, status: "failed", message: "Quota exceeded" } : s
            ),
          }));

          toast.warning(errorData?.detail?.message || "Quota limit reached.", { duration: 7000 });
          api.getQuota().then((q) => useStore.getState().setQuota(q)).catch(() => {});
          return;
        }

        if (res.status === 401) {
          useStore.getState().logout();
          toast.error("Session expired. Please log in again.");
          return;
        }

        throw new Error(`Chat failed with status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let currentEvent = "message";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let shouldTerminate = false;

        for (let line of lines) {
          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") || line === "data:") {
            const dataStr = line.startsWith("data: ") ? line.slice(6) : "";

            if (dataStr === "[DONE]" || currentEvent === "done") {
              shouldTerminate = true;
              break;
            }

            if (currentEvent === "token") {
              const tokenText = dataStr === "" ? "\n" : dataStr;
              currentText += tokenText;
              updateSessionStream(finalConvId, (prev) => ({
                ...prev,
                currentText: prev.currentText + tokenText,
              }));
            } else if (currentEvent === "answer") {
              try {
                currentText = JSON.parse(dataStr);
              } catch {
                currentText = dataStr;
              }
              updateSessionStream(finalConvId, (prev) => ({
                ...prev,
                currentText,
              }));
            } else if (currentEvent === "graph_status") {
              try {
                const status = JSON.parse(dataStr);
                updateSessionStream(finalConvId, (prev) => {
                  const existingIdx = prev.graphStatuses.findIndex((item: any) => item.node === status.node);
                  const nextStatuses = existingIdx === -1
                    ? [...prev.graphStatuses, status]
                    : prev.graphStatuses.map((item: any, idx) => (idx === existingIdx ? { ...item, ...status } : item));
                  return { ...prev, graphStatuses: nextStatuses };
                });
              } catch (e) {}
            } else if (currentEvent === "metadata") {
              try {
                const data = JSON.parse(dataStr);
                const mappedSources = mapSourcesToCitations(data.sources);
                finalCitations = mappedSources;
                finalChunks = data.chunks || undefined;
                finalMessageId = data.message_id || undefined;
                updateSessionStream(finalConvId, (prev) => ({
                  ...prev,
                  citations: mappedSources,
                  chunks: data.chunks || undefined,
                  finalMessageId: data.message_id || undefined,
                }));
              } catch (e) {}
            } else if (currentEvent === "rate_limit") {
              const rateLimitMsg = dataStr || "⏳ **Rate Limited** — The AI provider is busy. Please wait a moment and try again.";
              currentText = rateLimitMsg;
              updateSessionStream(finalConvId, (prev) => ({
                ...prev,
                currentText: rateLimitMsg,
                graphStatuses: prev.graphStatuses.map((s) =>
                  s.status === "running" ? { ...s, status: "failed", message: "Rate limited" } : s
                ),
              }));
              toast.warning("Rate limited by AI provider. Try again in a few seconds.", { duration: 6000 });
              shouldTerminate = true;
              break;
            } else if (currentEvent === "error") {
              const errMsg = dataStr ? `⚠️ **Error** — ${dataStr}` : "⚠️ **Error** — Something went wrong. Please try again.";
              currentText = errMsg;
              updateSessionStream(finalConvId, (prev) => ({
                ...prev,
                currentText: errMsg,
                graphStatuses: prev.graphStatuses.map((s) =>
                  s.status === "running" ? { ...s, status: "failed", message: dataStr || "Error" } : s
                ),
              }));
              toast.error(dataStr || "An error occurred during response streaming.", { duration: 6000 });
              shouldTerminate = true;
              break;
            }
          }
        }

        if (shouldTerminate) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return;
      }
      const errorMsgText = error?.message?.includes("status")
        ? `⚠️ **Server Error** — ${error.message}. Please try again.`
        : `⚠️ **Workspace Query Refusal**: Connection to backend failed.`;
      currentText = errorMsgText;
      updateSessionStream(finalConvId, (prev) => ({
        ...prev,
        currentText: errorMsgText,
        graphStatuses: prev.graphStatuses.map((s) =>
          s.status === "running" ? { ...s, status: "failed", message: "Connection failed" } : s
        ),
      }));
    } finally {
      const activeStreamSnapshot = useStore.getState().streamingSessions[finalConvId];
      const savedText =
        activeStreamSnapshot?.currentText ||
        currentText ||
        "⚠️ **Workspace Query Refusal**: Connection to backend failed.";
      const savedCitations = activeStreamSnapshot?.citations || finalCitations;
      const savedChunks = activeStreamSnapshot?.chunks || finalChunks;
      const savedDbId = activeStreamSnapshot?.finalMessageId || finalMessageId;

      // Unregister stream from global store
      setSessionStream(finalConvId, null);

      const finalAssistantMsg: Message = {
        id: botMsgId,
        dbId: savedDbId,
        sender: "assistant",
        text: savedText,
        timestamp: new Date().toISOString(),
        citations: savedCitations,
        chunks: savedChunks,
      };

      // Seed query cache with optimistic full conversation history
      queryClient.setQueryData(["sessionHistory", finalConvId], (old: any) => {
        const filtered = (old || []).filter(
          (m: any) => m.id !== botMsgId && m.id !== userMsg.id && !m.id.startsWith("msg-error-")
        );
        return [...filtered, userMsg, finalAssistantMsg];
      });

      // Refetch and sync React Query caches
      queryClient.invalidateQueries({ queryKey: ["sessionHistory", finalConvId] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      api.getQuota().then((q) => useStore.getState().setQuota(q)).catch(() => {});

      // Decision 3: Interactive Completion Notification when user is in another chat or view
      const currentActiveConv = useStore.getState().activeConvId;
      const currentTab = useStore.getState().currentTab;
      const isLookingAtThisChat = currentActiveConv === finalConvId && currentTab === "conversations";

      if (!isLookingAtThisChat) {
        toast.success(`Response ready in "${targetTitle}"`, {
          description: "Grounded answer and citations are ready.",
          action: {
            label: "View",
            onClick: () => {
              setActiveConvId(finalConvId);
              setCurrentTab("conversations");
            },
          },
          duration: 6000,
        });
      }
    }
  };

  const createSessionMutation = useMutation({
    mutationFn: async ({ title, docIds }: { title: string; docIds: string[] }) => {
      const createRes = await api.createSession();
      const sessionId = createRes.session_id;

      for (const docId of docIds) {
        await api.linkDocumentToSession(sessionId, docId);
      }
      return sessionId;
    },
    onSuccess: (newSessionId) => {
      queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setActiveConvId(newSessionId);
    },
  });

  const handleTakeToChat = (topic: string, selectedDocIds: string[]) => {
    setCurrentTab("conversations");
    createSessionMutation.mutate(
      { title: topic, docIds: selectedDocIds },
      {
        onSuccess: (newSessionId) => {
          setTimeout(() => {
            useStore.getState().setActiveConvId(newSessionId);
            handleSendMessage(topic);
          }, 100);
        },
      }
    );
  };

  const handleRetryMessage = async (messageId: string, currentChatMode?: "auto" | "research") => {
    if (!activeConvId || useStore.getState().streamingSessions[activeConvId]) return;
    const msgIdx = activeMessages.findIndex((m) => m.id === messageId);
    if (msgIdx === -1) return;

    let userMsgIdx = -1;
    for (let i = msgIdx - 1; i >= 0; i--) {
      if (activeMessages[i].sender === "user") {
        userMsgIdx = i;
        break;
      }
    }
    if (userMsgIdx === -1) return;

    const targetMsg = activeMessages[msgIdx];
    const isResearchQuota = targetMsg?.text?.includes("Deep Research Quota Exceeded");
    const retryMode: "auto" | "research" = isResearchQuota ? "research" : (currentChatMode || "auto");

    const userQuery = activeMessages[userMsgIdx].text;
    handleSendMessage(userQuery, retryMode);
  };

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteSession(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const handleDeleteSession = (id: string) => {
    const stream = useStore.getState().streamingSessions[id];
    if (stream?.abortController) {
      stream.abortController.abort();
    }
    setSessionStream(id, null);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    deleteSessionMutation.mutate(id);
  };

  const renameSessionMutation = useMutation({
    mutationFn: async ({ id, newName }: { id: string; newName: string }) => {
      await api.renameSession(id, newName);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sidebar-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const handleRenameSession = (id: string, newName: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: newName } : c)));
    renameSessionMutation.mutate({ id, newName });
  };

  const handleNewResearch = () => {
    setCurrentTab("conversations");
    setIsMobileSidebarOpen(false);
    setActiveConvId("");
    setDraftLinkedDocIds([]);
  };

  return {
    activeMessages,
    graphStatuses,
    handleSendMessage,
    handleRetryMessage,
    handleTakeToChat,
    handleNewResearch,
    handleDeleteSession,
    handleRenameSession,
    createSessionMutation,
  };
}
