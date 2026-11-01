import { useEffect, useState } from "react";
import { fetchCurrentUser, type CurrentUser } from "@/lib/current-user";

interface CurrentUserState {
  user: CurrentUser | null;
  error: string | null;
  isLoading: boolean;
}

/** Loads the signed-in user's role and name from GET /me once per mount. */
export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({ user: null, error: null, isLoading: true });

  useEffect(() => {
    let active = true;
    fetchCurrentUser()
      .then((user) => active && setState({ user, error: null, isLoading: false }))
      .catch((err) =>
        active &&
        setState({
          user: null,
          error: err instanceof Error ? err.message : "Could not load your account.",
          isLoading: false,
        })
      );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
