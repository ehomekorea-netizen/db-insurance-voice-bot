"use client";

import { useState, useEffect } from "react";

interface UserRecord {
  id: string;
  nickname: string;
  profileImage: string;
  status: "approved" | "blocked";
  updatedAt: string;
  geminiCost?: number;
  whisperCost?: number;
  groundingCount?: number;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  // Chat Logs Modal States
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserNickname, setSelectedUserNickname] = useState<string>("");
  const [chatLogs, setChatLogs] = useState<any[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  // Auto restore login session from localStorage
  useEffect(() => {
    const savedToken = localStorage.getItem("admin_session_token");
    if (savedToken) {
      setToken(savedToken);
      setIsLoggedIn(true);
      fetchUserList(savedToken);
    }
  }, []);

  // Fetch users list from backend API
  const fetchUserList = async (authToken: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 401) {
          handleLogout();
          throw new Error("인증 세션이 만료되었습니다.");
        }
        throw new Error("사용자 목록을 가져오지 못했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (err: any) {
      setError(err.message || "목록 조회 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // Submit passcode
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "비밀번호가 올바르지 않습니다.");
      }
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem("admin_session_token", data.token);
        setToken(data.token);
        setIsLoggedIn(true);
        fetchUserList(data.token);
      }
    } catch (err: any) {
      setError(err.message || "로그인에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // Session termination
  const handleLogout = () => {
    localStorage.removeItem("admin_session_token");
    setToken(null);
    setIsLoggedIn(false);
    setUsers([]);
    setError(null);
  };

  // Change user status (Approved <-> Blocked)
  const toggleUserStatus = async (userId: string, currentStatus: "approved" | "blocked") => {
    if (!token) return;
    const newStatus = currentStatus === "approved" ? "blocked" : "approved";
    const confirmMsg =
      newStatus === "blocked"
        ? "해당 사용자를 차단하시겠습니까? 로그인 정보는 남으나 대화방 진입이 통제됩니다."
        : "해당 사용자의 차단을 해제하고 서비스 사용을 다시 승인하시겠습니까?";

    if (!window.confirm(confirmMsg)) return;

    setActionUserId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId, status: newStatus })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "상태 업데이트 실패");
      }

      await fetchUserList(token);
    } catch (err: any) {
      alert(err.message || "상태 변경 중 오류가 발생했습니다.");
    } finally {
      setActionUserId(null);
    }
  };

  // Fetch user's chat logs
  const handleViewChatLogs = async (userId: string, nickname: string) => {
    setSelectedUserId(userId);
    setSelectedUserNickname(nickname);
    setIsLogsLoading(true);
    setChatLogs([]);
    try {
      const res = await fetch(`/api/admin/messages?userId=${userId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error("대화 기록을 가져오지 못했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        setChatLogs(data.logs || []);
      }
    } catch (err: any) {
      alert(err.message || "대화 기록 조회 실패");
    } finally {
      setIsLogsLoading(false);
    }
  };

  // Delete user's chat logs in Firebase (hard delete)
  const handleDeleteChatLogs = async (userId: string) => {
    if (!window.confirm("이 사용자의 모든 대화 기록을 DB(Firebase)에서 영구적으로 삭제하시겠습니까?\n삭제된 데이터는 완전히 지워지며 복구할 수 없습니다.")) return;

    try {
      const res = await fetch(`/api/admin/messages?userId=${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error("대화 기록 삭제에 실패했습니다.");
      }
      const data = await res.json();
      if (data.success) {
        alert("대화 기록을 DB에서 영구 삭제하여 보관 공간을 확보했습니다.");
        setChatLogs([]);
      }
    } catch (err: any) {
      alert(err.message || "삭제 도중 에러가 발생했습니다.");
    }
  };

  const formatDate = (isoStr: string) => {
    try {
      const date = new Date(isoStr);
      return date.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch {
      return isoStr;
    }
  };

  if (!isLoggedIn) {
    return (
      <main className="admin-login-shell">
        <div className="admin-login-card">
          <div className="admin-logo">
            <img src="/promy.png" alt="PROMY" />
            <h1>동목포 오멘토 어드민</h1>
            <p>가입 사용자 접근 제어 시스템</p>
          </div>

          <form onSubmit={handleLogin} className="admin-login-form">
            <div className="input-group">
              <label htmlFor="admin-pw">관리자 비밀번호</label>
              <input
                id="admin-pw"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {error && <div className="admin-error-text">{error}</div>}

            <button type="submit" className="admin-submit-btn" disabled={isLoading}>
              {isLoading ? "인증 확인 중..." : "관리자 로그인"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-dashboard-shell">
      <header className="admin-dashboard-header">
        <div className="admin-header-title">
          <img src="/promy.png" alt="PROMY" className="admin-header-logo" />
          <div>
            <h1>동목포 오멘토 관리자</h1>
            <p>실시간 가입자 조회 및 차단 관리</p>
          </div>
        </div>
        <button onClick={handleLogout} className="admin-logout-btn">
          로그아웃
        </button>
      </header>

      <section className="admin-dashboard-content">
        <div className="admin-card-panel">
          <div className="panel-header">
            <h2>가입 사용자 목록 ({users.length}명)</h2>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className="mobile-scroll-tip">
                ← 터치 스크롤 가능 →
              </span>
              <button
                onClick={() => token && fetchUserList(token)}
                className="admin-refresh-btn"
                disabled={isLoading}
              >
                새로고침 🔄
              </button>
            </div>
          </div>

          {error && <div className="admin-error-banner">{error}</div>}

          {isLoading && users.length === 0 ? (
            <div className="admin-loading-spinner">가입자 데이터를 읽어오는 중...</div>
          ) : users.length === 0 ? (
            <div className="admin-empty-state">아직 접속한 사용자가 없습니다.</div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-user-table">
                <thead>
                  <tr>
                    <th>프로필</th>
                    <th>닉네임</th>
                    <th>카카오 ID</th>
                    <th>STT 사용료</th>
                    <th>Gemini 3.1 Flash-Lite 비용 (그라운딩 횟수)</th>
                    <th>총 비용</th>
                    <th>최종 활동 시각</th>
                    <th>상태</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className={user.status === "blocked" ? "blocked-row" : ""}>
                      <td>
                        <div className="admin-table-avatar">
                          {user.profileImage ? (
                            <img src={user.profileImage} alt={user.nickname} />
                          ) : (
                            <div className="admin-avatar-placeholder">
                              {user.nickname ? user.nickname.slice(0, 2) : "PA"}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="font-bold">{user.nickname}</td>
                      <td className="text-gray">{user.id}</td>
                      <td>
                        ₩{(user.whisperCost || 0).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </td>
                      <td>
                        ₩{(user.geminiCost || 0).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ({user.groundingCount || 0}회)
                      </td>
                      <td style={{ fontWeight: "700" }}>
                        ₩{((user.geminiCost || 0) + (user.whisperCost || 0)).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </td>
                      <td className="text-gray">{formatDate(user.updatedAt)}</td>
                      <td>
                        <span className={`status-badge ${user.status}`}>
                          {user.status === "approved" ? "승인됨 🟢" : "차단됨 🔴"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => toggleUserStatus(user.id, user.status)}
                            className={`admin-action-btn ${
                              user.status === "approved" ? "block-action" : "approve-action"
                            }`}
                            disabled={actionUserId === user.id}
                          >
                            {actionUserId === user.id
                              ? "처리 중..."
                              : user.status === "approved"
                              ? "차단하기"
                              : "승인/해제"}
                          </button>
                          <button
                            onClick={() => handleViewChatLogs(user.id, user.nickname)}
                            className="admin-action-btn approve-action"
                            style={{ background: "var(--accent-teal, #10b981)", borderColor: "var(--text-ink)" }}
                          >
                            대화 기록
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {selectedUserId && (
        <div className="admin-modal-overlay" onClick={() => setSelectedUserId(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2>{selectedUserNickname}님의 대화 기록</h2>
                <p>카카오 ID: {selectedUserId}</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {chatLogs.length > 0 && (
                  <button 
                    onClick={() => handleDeleteChatLogs(selectedUserId)}
                    style={{
                      background: "#fee2e2",
                      border: "2px solid var(--text-ink, #20343A)",
                      color: "#991b1b",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontSize: "12.5px",
                      fontWeight: "800",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      boxShadow: "2px 2px 0px var(--text-ink, #20343A)"
                    }}
                    title="이 사용자의 전체 대화 기록 영구 삭제"
                  >
                    대화 삭제 🗑️
                  </button>
                )}
                <button className="modal-close-btn" onClick={() => setSelectedUserId(null)}>
                  &times;
                </button>
              </div>
            </header>
            
            <div className="modal-body">
              {isLogsLoading ? (
                <div className="modal-loading">대화 기록을 불러오는 중...</div>
              ) : chatLogs.length === 0 ? (
                <div className="modal-empty">아직 기록된 대화가 없습니다.</div>
              ) : (
                <div className="modal-chat-list">
                  {chatLogs.map((log) => (
                    <div key={log.id} className={`modal-chat-item ${log.role}`}>
                      <div className="chat-bubble-header">
                        <span className="chat-sender">
                          {log.role === "user" ? selectedUserNickname : "프로미"}
                        </span>
                        <span className="chat-time">
                          {formatDate(log.timestamp)}
                        </span>
                      </div>
                      <div className="chat-bubble-content">
                        {log.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
