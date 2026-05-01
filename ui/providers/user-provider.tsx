"use client";

import { createContext, useContext, ReactNode } from "react";
import { useFheWallet } from "@/hooks/use-fhe-wallet";
import { useCurrentUser } from "@/hooks/use-user";
import { User } from "@/types/user.interface";

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  error: Error | null;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useFheWallet();
  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = useCurrentUser(isConnected ? address : undefined);

  return (
    <UserContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error: error ?? null,
        refreshUser: async () => {
          await refetch();
        },
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
