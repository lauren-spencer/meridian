import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function createGoogleProvider(includeGmailScope: boolean): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  if (includeGmailScope) {
    for (const scope of SCOPES) {
      provider.addScope(scope);
    }
  }
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}

let isSigningIn = false;
// Strictly in-memory OAuth token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

function formatGoogleAuthError(error: unknown): Error {
  const errObj = error as { code?: string; message?: string };
  const code = errObj?.code || '';
  if (code === 'auth/popup-blocked') {
    return new Error(
      'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.'
    );
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return new Error('Google sign-in popup was closed before completing.');
  }
  if (code === 'auth/unauthorized-domain') {
    return new Error(
      `This preview domain (${window.location.hostname}) is not authorized in Firebase Auth. Try opening from the main AI Studio preview URL.`
    );
  }
  if (code === 'auth/operation-not-allowed') {
    return new Error('Google Sign-In is not enabled on the Firebase project.');
  }
  if (code === 'auth/network-request-failed') {
    return new Error('Network error while contacting Google Sign-In. Check your connection and retry.');
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error('Google Sign-In failed. Please try again.');
}

export const initGoogleAuth = (
  onAuthChange: (state: {
    user: User | null;
    gmailAccessToken: string | null;
    authReady: boolean;
  }) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    // Do not emit intermediate state while signInWithPopup is resolving its OAuth credential
    if (isSigningIn) {
      return;
    }
    if (user) {
      onAuthChange({
        user,
        gmailAccessToken: cachedAccessToken,
        authReady: true,
      });
    } else {
      cachedAccessToken = null;
      onAuthChange({
        user: null,
        gmailAccessToken: null,
        authReady: true,
      });
    }
  });
};

export const signInWithGoogleAccount = async (
  includeGmailScope = false
): Promise<{
  user: User;
  accessToken: string | null;
}> => {
  try {
    isSigningIn = true;
    const provider = createGoogleProvider(includeGmailScope);
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (includeGmailScope && credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
    }
    return {
      user: result.user,
      accessToken: includeGmailScope ? cachedAccessToken : null,
    };
  } catch (error) {
    throw formatGoogleAuthError(error);
  } finally {
    isSigningIn = false;
  }
};

export const signInWithGoogleGmail = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const provider = createGoogleProvider(true);
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Google Sign-In succeeded, but Gmail permission was not granted. Please check the Gmail access box on the consent screen.'
      );
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    throw formatGoogleAuthError(error);
  } finally {
    isSigningIn = false;
  }
};

export const getGmailAccessToken = (): string | null => cachedAccessToken;

export const clearGmailAccessToken = (): void => {
  cachedAccessToken = null;
};

export const signOutGoogle = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};
