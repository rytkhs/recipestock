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

export const sendEmailLoginCode = async (email: string) => {
  await postJson("/api/auth/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
};

export const signInWithEmailCode = async (email: string, otp: string) => {
  await postJson("/api/auth/sign-in/email-otp", {
    email,
    otp,
  });
};
