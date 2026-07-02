import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Link as LinkIcon,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "mapaiving:v1";
const AUTO_SYNC_KEY = "mapaiving-private-state";
const SYNC_API_URL =
  import.meta.env.VITE_SYNC_API_URL ||
  "https://mapaiving-sync.reply-marketing-ads.workers.dev";
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

const defaultTodos = [
  { id: "task-1", text: "오늘 볼 링크 하나 저장하기", done: false },
  { id: "task-2", text: "콘텐츠 아이디어 메모 남기기", done: false },
];

const initialState = {
  folders: [
    { id: "all", name: "전체", pinned: true },
    { id: "ideas", name: "아이디어", pinned: true },
    { id: "work", name: "업무", pinned: false },
    { id: "content", name: "콘텐츠", pinned: false },
  ],
  items: [
    {
      id: "sample-1",
      type: "link",
      title: "나중에 볼 링크",
      url: "https://example.com/",
      memo: "지금은 넘기고, 필요할 때 다시 보기",
      folderId: "ideas",
      tags: ["레퍼런스", "아이디어"],
      createdAt: new Date().toISOString(),
      revisits: 0,
      source: "example.com",
    },
    {
      id: "sample-2",
      type: "note",
      title: "콘텐츠 메모",
      url: "",
      memo: "짧은 생각도 일단 저장해두기",
      folderId: "content",
      tags: ["메모", "기획"],
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      revisits: 1,
      source: "직접 입력",
    },
  ],
  todos: defaultTodos,
  announcementSeen: false,
  onboardingDone: false,
  updatedAt: new Date().toISOString(),
};

function normalizeState(value) {
  const { liveNote, ...rest } = value || {};
  const todos = value?.todos || liveNote?.tasks || defaultTodos;
  return {
    ...initialState,
    ...rest,
    folders: value?.folders || initialState.folders,
    items: value?.items || initialState.items,
    todos,
    updatedAt: value?.updatedAt || initialState.updatedAt,
  };
}

function mergeById(primary = [], secondary = []) {
  const primaryIds = new Set(primary.map((item) => item.id));
  return [
    ...primary,
    ...secondary.filter((item) => item?.id && !primaryIds.has(item.id)),
  ];
}

function statesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeStates(localState, remoteState) {
  const local = normalizeState(localState);
  const remote = normalizeState(remoteState);
  const localTime = new Date(local.updatedAt || 0).getTime();
  const remoteTime = new Date(remote.updatedAt || 0).getTime();
  const primary = localTime >= remoteTime ? local : remote;
  const secondary = primary === local ? remote : local;
  const validTimes = [localTime, remoteTime].filter(Number.isFinite);
  const latestTime = validTimes.length ? Math.max(...validTimes) : Date.now();

  return normalizeState({
    ...primary,
    folders: mergeById(primary.folders, secondary.folders),
    items: mergeById(primary.items, secondary.items),
    todos: mergeById(primary.todos, secondary.todos),
    updatedAt: new Date(latestTime).toISOString(),
  });
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialState;
    return normalizeState(JSON.parse(saved));
  } catch {
    return initialState;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function touchState(state) {
  return {
    ...state,
    updatedAt: new Date().toISOString(),
  };
}

function getSyncUrl(syncKey) {
  return `${SYNC_API_URL.replace(/\/$/, "")}/state/${encodeURIComponent(syncKey)}`;
}

async function pullRemoteState(syncKey, signal) {
  const response = await fetch(getSyncUrl(syncKey), { signal });
  if (!response.ok) {
    throw new Error("동기화 정보를 불러오지 못했어요.");
  }
  return response.json();
}

async function pushRemoteState(syncKey, state, signal) {
  const response = await fetch(getSyncUrl(syncKey), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state,
      updatedAt: state.updatedAt || new Date().toISOString(),
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error("동기화 저장에 실패했어요.");
  }
  return response.json();
}

function getRoute() {
  const path = window.location.pathname;
  if (path.includes("/onboarding")) return "onboarding";
  if (path.includes("/settings/announcement/17")) return "announcement";
  return "home";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getSource(url) {
  if (!url) return "직접 입력";
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "링크";
  }
}

function getStreak(items) {
  if (items.length === 0) return 0;
  const savedDays = new Set(
    items.map((item) => new Date(item.createdAt).toISOString().slice(0, 10)),
  );
  let streak = 0;
  const cursor = new Date();
  while (savedDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function navigate(path) {
  const nextPath = path === "/" ? (BASE_PATH ? `${BASE_PATH}/` : "/") : `${BASE_PATH}${path}`;
  window.history.pushState({}, "", nextPath);
  window.dispatchEvent(new Event("popstate"));
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [state, setState] = useState(loadState);
  const remoteReadyRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    const cleanKey = AUTO_SYNC_KEY;
    remoteReadyRef.current = false;

    if (!SYNC_API_URL) {
      console.warn("Sync API URL is missing.");
      return undefined;
    }

    const controller = new AbortController();

    pullRemoteState(cleanKey, controller.signal)
      .then((remote) => {
        if (remote?.state) {
          const remoteState = normalizeState(remote.state);
          const mergedState = mergeStates(state, remoteState);
          const shouldUpdateLocal = !statesMatch(mergedState, state);
          const shouldUpdateRemote = !statesMatch(mergedState, remoteState);
          const nextState = shouldUpdateRemote ? touchState(mergedState) : mergedState;

          if (shouldUpdateLocal) {
            setState(nextState);
          }

          if (shouldUpdateRemote) {
            return pushRemoteState(cleanKey, nextState, controller.signal);
          }
        } else {
          return pushRemoteState(cleanKey, state, controller.signal);
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        console.warn(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          remoteReadyRef.current = true;
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const cleanKey = AUTO_SYNC_KEY;
    if (!cleanKey || !SYNC_API_URL || !remoteReadyRef.current) return undefined;

    clearTimeout(saveTimerRef.current);
    const controller = new AbortController();

    saveTimerRef.current = setTimeout(() => {
      pushRemoteState(cleanKey, state, controller.signal)
        .catch((error) => {
          if (error.name === "AbortError") return;
          console.warn(error.message);
        });
    }, 1400);

    return () => {
      clearTimeout(saveTimerRef.current);
      controller.abort();
    };
  }, [state]);

  const updateState = (updater) => {
    setState((current) => touchState(
      typeof updater === "function" ? updater(current) : updater,
    ));
  };

  if (route === "onboarding") {
    return <Onboarding state={state} updateState={updateState} />;
  }

  if (route === "announcement") {
    return <Announcement state={state} updateState={updateState} />;
  }

  return (
    <Home
      state={state}
      updateState={updateState}
    />
  );
}

function Home({ state, updateState }) {
  const [activeFolder, setActiveFolder] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [query, setQuery] = useState("");
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [isFolderOpen, setFolderOpen] = useState(false);

  const stats = useMemo(
    () => ({
      total: state.items.length,
      revisits: state.items.reduce((sum, item) => sum + item.revisits, 0),
      streak: getStreak(state.items),
    }),
    [state.items],
  );

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let items = [...state.items];

    if (activeFolder !== "all") {
      items = items.filter((item) => item.folderId === activeFolder);
    }

    if (keyword) {
      items = items.filter((item) => {
        const searchable = [
          item.title,
          item.url,
          item.memo,
          item.source,
          item.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(keyword);
      });
    }

    if (sortBy === "title") {
      items.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    }

    if (sortBy === "saved") {
      items.sort((a, b) => b.revisits - a.revisits);
    }

    if (sortBy === "recent") {
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return items;
  }, [activeFolder, query, sortBy, state.items]);

  const addItem = (item) => {
    updateState((current) => ({
      ...current,
      items: [item, ...current.items],
    }));
  };

  const deleteItem = (id) => {
    updateState((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== id),
    }));
  };

  const revisitItem = (id) => {
    updateState((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, revisits: item.revisits + 1 } : item,
      ),
    }));
  };

  const addFolder = (name) => {
    updateState((current) => ({
      ...current,
      folders: [
        ...current.folders,
        {
          id: `folder-${Date.now()}`,
          name,
          pinned: false,
        },
      ],
    }));
  };

  const deleteFolder = (id) => {
    updateState((current) => ({
      ...current,
      folders: current.folders.filter((folder) => folder.id !== id),
      items: current.items.map((item) =>
        item.folderId === id ? { ...item, folderId: "all" } : item,
      ),
    }));
    setActiveFolder("all");
  };

  const addTasks = (text) => {
    const lines = text
      .split(/\r?\n|\\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    updateState((current) => ({
      ...current,
      todos: [
        ...(current.todos || []),
        ...lines.map((line, index) => ({
          id: `task-${Date.now()}-${index}`,
          text: line,
          done: false,
        })),
      ],
    }));
  };

  const updateTask = (id, patch) => {
    updateState((current) => ({
      ...current,
      todos: (current.todos || []).map((task) =>
        task.id === id ? { ...task, ...patch } : task,
      ),
    }));
  };

  const deleteTask = (id) => {
    updateState((current) => ({
      ...current,
      todos: (current.todos || []).filter((task) => task.id !== id),
    }));
  };

  const moveTask = (id, direction) => {
    updateState((current) => {
      const tasks = [...(current.todos || [])];
      const index = tasks.findIndex((task) => task.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= tasks.length) return current;
      [tasks[index], tasks[nextIndex]] = [tasks[nextIndex], tasks[index]];

      return {
        ...current,
        todos: tasks,
      };
    });
  };

  const clearDoneTasks = () => {
    updateState((current) => ({
      ...current,
      todos: (current.todos || []).filter((task) => !task.done),
    }));
  };

  return (
    <main className="page">
      <section className="phone-shell" aria-label="마파이빙 홈">
        <Header onOpenComposer={() => setComposerOpen(true)} />

        <div className="search-row">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="무엇을 다시 찾을까요?"
            aria-label="저장 콘텐츠 검색"
          />
          {query ? (
            <button
              className="icon-button compact"
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>

        <TodoPanel
          todos={state.todos}
          addTasks={addTasks}
          updateTask={updateTask}
          deleteTask={deleteTask}
          moveTask={moveTask}
          clearDoneTasks={clearDoneTasks}
        />

        <StatsPanel stats={stats} />

        <QuickLinks />

        <FolderTabs
          folders={state.folders}
          activeFolder={activeFolder}
          setActiveFolder={setActiveFolder}
          onOpenFolder={() => setFolderOpen(true)}
        />

        <SortTabs sortBy={sortBy} setSortBy={setSortBy} />

        <ContentList
          items={filteredItems}
          folders={state.folders}
          onDelete={deleteItem}
          onRevisit={revisitItem}
          onOpenComposer={() => setComposerOpen(true)}
        />
      </section>

      {isComposerOpen ? (
        <Composer
          folders={state.folders}
          onClose={() => setComposerOpen(false)}
          onSave={(item) => {
            addItem(item);
            setComposerOpen(false);
          }}
        />
      ) : null}

      {isFolderOpen ? (
        <FolderManager
          folders={state.folders}
          onAdd={addFolder}
          onDelete={deleteFolder}
          onClose={() => setFolderOpen(false)}
        />
      ) : null}
    </main>
  );
}

function TodoPanel({
  todos,
  addTasks,
  updateTask,
  deleteTask,
  moveTask,
  clearDoneTasks,
}) {
  const [taskDraft, setTaskDraft] = useState("");
  const tasks = todos || [];
  const doneCount = tasks.filter((task) => task.done).length;

  const submitTasks = () => {
    addTasks(taskDraft);
    setTaskDraft("");
  };

  const handleTaskPaste = (event) => {
    const text = event.clipboardData.getData("text");
    const lines = text
      .split(/\r?\n|\\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) return;
    event.preventDefault();
    addTasks(text);
    setTaskDraft("");
  };

  return (
    <section className="todo-panel" aria-label="할 일 목록">
      <div className="todo-panel-header">
        <div>
          <span className="eyebrow">할 일</span>
          <h2>오늘 챙길 것</h2>
        </div>
        <div className="todo-count-chip">
          <Check size={14} />
          {tasks.length - doneCount}개 남음
        </div>
      </div>

      <div className="todo-list">
        {tasks.length === 0 ? (
          <p className="todo-empty">오늘 해야 할 일을 추가해보세요.</p>
        ) : null}
        {tasks.map((task, index) => (
          <div key={task.id} className={task.done ? "todo-row done" : "todo-row"}>
            <input
              type="checkbox"
              checked={task.done}
              onChange={(event) =>
                updateTask(task.id, { done: event.target.checked })
              }
              aria-label={`${task.text} 완료 여부`}
            />
            <input
              type="text"
              value={task.text}
              onChange={(event) =>
                updateTask(task.id, { text: event.target.value })
              }
              aria-label="할 일 내용"
            />
            <div className="task-actions">
              <button
                type="button"
                onClick={() => moveTask(task.id, -1)}
                disabled={index === 0}
                aria-label="위로 이동"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveTask(task.id, 1)}
                disabled={index === tasks.length - 1}
                aria-label="아래로 이동"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => deleteTask(task.id)}
                aria-label="할 일 삭제"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <label className="todo-field">
        할 일 추가
        <textarea
          value={taskDraft}
          onChange={(event) => setTaskDraft(event.target.value)}
          onPaste={handleTaskPaste}
          placeholder={"한 줄에 하나씩 붙여넣으면\n각각 할 일로 추가돼요"}
        />
      </label>
      <div className="todo-editor-actions">
        <button type="button" onClick={submitTasks}>
          <Plus size={16} />
          추가
        </button>
        <button type="button" onClick={clearDoneTasks}>
          완료 항목 지우기
        </button>
      </div>
    </section>
  );
}

function Header({ onOpenComposer }) {
  return (
    <header className="app-header compact-header">
      <button
        className="text-button"
        type="button"
        onClick={() => navigate("/settings/announcement/17")}
      >
        <Bell size={16} />
        업데이트
      </button>
      <div className="header-actions">
        <button
          className="icon-button primary"
          type="button"
          onClick={onOpenComposer}
          aria-label="새 콘텐츠 저장"
        >
          <Plus size={20} />
        </button>
      </div>
    </header>
  );
}

function StatsPanel({ stats }) {
  return (
    <section className="stats-panel">
      <div className="stats-copy">
        <p>개인 아카이브</p>
        <h1>오늘 볼 것만 남겨요</h1>
      </div>
      <div className="stat-grid">
        <Stat label="저장" value={stats.total} unit="개" />
        <Stat label="다시 봄" value={stats.revisits} unit="회" />
        <Stat label="연속" value={stats.streak} unit="일" />
      </div>
    </section>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

function QuickLinks() {
  const links = [
    {
      icon: FileText,
      title: "처음 쓰는 방법",
      description: "할 일 쓰기",
      path: "/onboarding",
    },
    {
      icon: Sparkles,
      title: "업데이트",
      description: "이번 버전 보기",
      path: "/settings/announcement/17",
    },
  ];

  return (
    <section className="quick-links" aria-label="빠른 안내">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <button
            key={link.title}
            className="quick-card"
            type="button"
            onClick={() => navigate(link.path)}
          >
            <span className="quick-icon">
              <Icon size={18} />
            </span>
            <span>
              <strong>{link.description}</strong>
              <small>{link.title}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        );
      })}
    </section>
  );
}

function FolderTabs({ folders, activeFolder, setActiveFolder, onOpenFolder }) {
  return (
    <section className="folder-section" aria-label="폴더">
      <div className="section-title">
        <span>폴더</span>
        <button className="text-button" type="button" onClick={onOpenFolder}>
          <FolderPlus size={16} />
          관리
        </button>
      </div>
      <div className="folder-tabs">
        {folders.map((folder) => (
          <button
            key={folder.id}
            className={folder.id === activeFolder ? "active" : ""}
            type="button"
            onClick={() => setActiveFolder(folder.id)}
          >
            {folder.pinned ? <Star size={13} /> : <Folder size={13} />}
            {folder.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function SortTabs({ sortBy, setSortBy }) {
  return (
    <div className="sort-tabs" aria-label="정렬">
      <button
        type="button"
        className={sortBy === "title" ? "active" : ""}
        onClick={() => setSortBy("title")}
      >
        이름순
      </button>
      <span aria-hidden="true">|</span>
      <button
        type="button"
        className={sortBy === "saved" ? "active" : ""}
        onClick={() => setSortBy("saved")}
      >
        많이 본 순
      </button>
      <span aria-hidden="true">|</span>
      <button
        type="button"
        className={sortBy === "recent" ? "active" : ""}
        onClick={() => setSortBy("recent")}
      >
        최신순
      </button>
    </div>
  );
}

function ContentList({ items, folders, onDelete, onRevisit, onOpenComposer }) {
  if (items.length === 0) {
    return (
      <section className="empty-state">
        <div className="empty-icon">
          <Bookmark size={28} />
        </div>
        <h2>아직 저장한 게 없어요</h2>
        <p>링크, 이미지, 메모 중 하나를 먼저 담아보세요.</p>
        <button className="primary-button" type="button" onClick={onOpenComposer}>
          <Plus size={18} />
          바로 저장하기
        </button>
      </section>
    );
  }

  return (
    <section className="content-list" aria-label="저장 콘텐츠 목록">
      {items.map((item) => (
        <ContentCard
          key={item.id}
          item={item}
          folder={folders.find((folder) => folder.id === item.folderId)}
          onDelete={onDelete}
          onRevisit={onRevisit}
        />
      ))}
    </section>
  );
}

function ContentCard({ item, folder, onDelete, onRevisit }) {
  const TypeIcon =
    item.type === "image" ? ImageIcon : item.type === "note" ? FileText : LinkIcon;

  return (
    <article className={`content-card ${item.type}`}>
      <div className="card-thumb">
        {item.type === "image" && item.image ? (
          <img src={item.image} alt="" />
        ) : (
          <TypeIcon size={24} />
        )}
      </div>
      <div className="card-body">
        <div className="card-meta">
          <span>{folder?.name || "전체"}</span>
          <span>{formatDate(item.createdAt)}</span>
        </div>
        <h2>{item.title}</h2>
        <p>{item.memo || item.source}</p>
        <div className="tag-row">
          {item.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        <div className="card-actions">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => onRevisit(item.id)}
            >
              <ExternalLink size={15} />
              열기
            </a>
          ) : (
            <button type="button" onClick={() => onRevisit(item.id)}>
              <Clock3 size={15} />
              본 것으로 표시
            </button>
          )}
          <button type="button" onClick={() => onDelete(item.id)}>
            <Trash2 size={15} />
            지우기
          </button>
        </div>
      </div>
    </article>
  );
}

function Composer({ folders, onClose, onSave }) {
  const [type, setType] = useState("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [memo, setMemo] = useState("");
  const [folderId, setFolderId] = useState(folders[0]?.id || "all");
  const [tags, setTags] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");

  const handleImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = (event) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanUrl = url.trim();
    const cleanMemo = memo.trim();

    if (!cleanTitle && !cleanUrl && !cleanMemo && !image) {
      setError("하나라도 입력하면 저장할 수 있어요.");
      return;
    }

    onSave({
      id: `item-${Date.now()}`,
      type,
      title:
        cleanTitle ||
        (type === "link" ? getSource(cleanUrl) : type === "image" ? "이미지 저장" : "메모 저장"),
      url: cleanUrl,
      memo: cleanMemo,
      folderId,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
      revisits: 0,
      source: getSource(cleanUrl),
      image,
    });
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="새 콘텐츠 저장">
      <form className="sheet composer" onSubmit={submit}>
        <div className="sheet-header">
          <div>
            <span className="eyebrow">저장</span>
            <h2>무엇을 담을까요?</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        <div className="type-tabs">
          <button
            type="button"
            className={type === "link" ? "active" : ""}
            onClick={() => setType("link")}
          >
            <LinkIcon size={17} />
            링크
          </button>
          <button
            type="button"
            className={type === "image" ? "active" : ""}
            onClick={() => setType("image")}
          >
            <ImageIcon size={17} />
            이미지
          </button>
          <button
            type="button"
            className={type === "note" ? "active" : ""}
            onClick={() => setType("note")}
          >
            <FileText size={17} />
            메모
          </button>
        </div>

        <label>
          제목
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="예: 광고 레퍼런스"
          />
        </label>

        {type === "link" ? (
          <label>
            링크
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="붙여넣을 링크"
              inputMode="url"
            />
          </label>
        ) : null}

        {type === "image" ? (
          <label className="upload-box">
            <Upload size={20} />
            <span>{image ? "이미지를 담았어요" : "이미지 선택"}</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => handleImage(event.target.files?.[0])}
            />
          </label>
        ) : null}

        <label>
          메모
          <textarea
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="왜 저장했는지 짧게 남겨두기"
          />
        </label>

        <div className="field-grid">
          <label>
            폴더
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            태그
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="예: 광고,레퍼런스"
            />
          </label>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-button full" type="submit">
          <Check size={18} />
          저장하기
        </button>
      </form>
    </div>
  );
}

function FolderManager({ folders, onAdd, onDelete, onClose }) {
  const [name, setName] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    onAdd(cleanName);
    setName("");
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="폴더 관리">
      <section className="sheet">
        <div className="sheet-header">
          <div>
            <span className="eyebrow">폴더</span>
            <h2>폴더 관리</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        <form className="folder-form" onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="새 폴더명"
          />
          <button type="submit">
            <Plus size={18} />
          </button>
        </form>
        <div className="folder-manage-list">
          {folders.map((folder) => (
            <div key={folder.id}>
              <span>
                {folder.pinned ? <Star size={15} /> : <Folder size={15} />}
                {folder.name}
              </span>
              {folder.id !== "all" ? (
                <button type="button" onClick={() => onDelete(folder.id)}>
                  <Trash2 size={15} />
                </button>
              ) : (
                <MoreHorizontal size={15} />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Onboarding({ state, updateState }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: Check,
      title: "할 일을 바로 적어요",
      body: "오늘 챙길 일을 짧게 적고 완료하면 체크할 수 있어요.",
    },
    {
      icon: Check,
      title: "여러 줄도 한 번에 넣어요",
      body: "여러 줄을 붙여넣으면 각각의 할 일로 자동 추가돼요.",
    },
    {
      icon: Search,
      title: "링크와 메모도 같이 찾아요",
      body: "저장한 링크, 이미지, 메모는 제목과 태그로 다시 찾을 수 있어요.",
    },
  ];

  const CurrentIcon = steps[step].icon;

  const complete = () => {
    updateState({ ...state, onboardingDone: true });
    navigate("/");
  };

  return (
    <main className="page onboarding-page">
      <section className="phone-shell centered">
        <header className="simple-header">
          <button className="icon-button" type="button" onClick={() => navigate("/")}>
            <X size={20} />
          </button>
          <button className="text-button" type="button" onClick={() => navigate("/")}>
            건너뛰기
          </button>
        </header>

        <section className="onboarding-card">
          <div className="onboarding-visual">
            <CurrentIcon size={52} />
          </div>
          <p className="step-count">
            {step + 1} / {steps.length}
          </p>
          <h1>{steps[step].title}</h1>
          <p>{steps[step].body}</p>
        </section>

        <div className="progress-dots">
          {steps.map((item, index) => (
            <span key={item.title} className={index === step ? "active" : ""} />
          ))}
        </div>

        <button
          className="primary-button full"
          type="button"
          onClick={() => (step === steps.length - 1 ? complete() : setStep(step + 1))}
        >
          {step === steps.length - 1 ? "시작하기" : "다음"}
          <ChevronRight size={18} />
        </button>
      </section>
    </main>
  );
}

function Announcement({ state, updateState }) {
  useEffect(() => {
    if (!state.announcementSeen) {
      updateState({ ...state, announcementSeen: true });
    }
  }, [state, updateState]);

  return (
    <main className="page announcement-page">
      <section className="phone-shell">
        <header className="simple-header">
          <button className="icon-button" type="button" onClick={() => navigate("/")}>
            <X size={20} />
          </button>
          <strong>공지사항</strong>
          <span className="header-spacer" />
        </header>

        <article className="announcement-article">
          <span className="notice-badge">마파이빙 v0.1</span>
          <h1>개인용 저장함을 열었습니다</h1>
          <p className="notice-date">2026.07.02</p>
          <div className="notice-body">
            <p>
              링크 저장함에 간단한 할 일 기능을 더했습니다.
            </p>
            <ul>
              <li>할 일 추가, 수정, 체크</li>
              <li>할 일 순서 변경과 삭제</li>
              <li>완료한 항목 한 번에 지우기</li>
              <li>여러 줄 붙여넣기 시 할 일 자동 생성</li>
              <li>링크, 이미지, 메모 저장</li>
              <li>Cloudflare 기반 자동 저장</li>
            </ul>
            <p>
              같은 주소로 접속하면 저장한 데이터를 이어서 볼 수 있어요.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
