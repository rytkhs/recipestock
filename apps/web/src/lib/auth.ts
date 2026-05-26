const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("auth_request_failed");
  }

  return response.json().catch(() => null) as Promise<unknown>;
};

export const startGoogleLogin = async () => {
  const data = await postJson("/api/auth/sign-in/social", {
    provider: "google",
    callbackURL: `${window.location.origin}/recipes`,
    disableRedirect: true,
  });

  if (
    data &&
    typeof data === "object" &&
    "url" in data &&
    typeof data.url === "string" &&
    data.url.length > 0
  ) {
    window.location.assign(data.url);
  }
};

const buildInternalName = (email: string) => {
  const localPart = email.split("@")[0]?.trim();
  return localPart && localPart.length > 0 ? localPart : "user";
};

export const signInWithEmailPassword = async (email: string, password: string) => {
  await postJson("/api/auth/sign-in/email", {
    email,
    password,
    callbackURL: `${window.location.origin}/recipes`,
  });
};

export const signUpWithEmailPassword = async (email: string, password: string) => {
  await postJson("/api/auth/sign-up/email", {
    name: buildInternalName(email),
    email,
    password,
    callbackURL: `${window.location.origin}/recipes`,
  });
};

export const verifySignUpOtp = async (email: string, otp: string) => {
  await postJson("/api/auth/email-otp/verify-email", {
    email,
    otp,
  });
};

export const requestPasswordResetOtp = async (email: string) => {
  await postJson("/api/auth/email-otp/request-password-reset", {
    email,
  });
};

export const resetPasswordWithOtp = async (email: string, otp: string, password: string) => {
  await postJson("/api/auth/email-otp/reset-password", {
    email,
    otp,
    password,
  });
};
