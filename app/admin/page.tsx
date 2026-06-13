"use client";

import { useState, useEffect } from "react";

interface UserRecord {
  id: string;
  nickname: string;
  profileImage: string;
  status: "approved" | "blocked";
  updatedAt: string;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

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
            <button
              onClick={() => token && fetchUserList(token)}
              className="admin-refresh-btn"
              disabled={isLoading}
            >
              새로고침 🔄
            </button>
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
                            <img src={user.profileImage} alt="" />
                          ) : (
                            <div className="admin-avatar-placeholder">PA</div>
                          )}
                        </div>
                      </td>
                      <td className="font-bold">{user.nickname}</td>
                      <td className="text-gray">{user.id}</td>
                      <td className="text-gray">{formatDate(user.updatedAt)}</td>
                      <td>
                        <span className={`status-badge ${user.status}`}>
                          {user.status === "approved" ? "승인됨 🟢" : "차단됨 🔴"}
                        </span>
                      </td>
                      <td>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
