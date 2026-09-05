import React, { createContext, useContext, useEffect, useState } from 'react';
import { getStoredSession, login as apiLogin, signup as apiSignup, logout as apiLogout } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { token, email } | null
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStoredSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  const login = async (email, password) => {
    const data = await apiLogin(email, password);
    setSession({ token: data.token, email: data.user.email });
  };

  const signup = async (email, password) => {
    const data = await apiSignup(email, password);
    setSession({ token: data.token, email: data.user.email });
  };

  const logout = async () => {
    await apiLogout();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
