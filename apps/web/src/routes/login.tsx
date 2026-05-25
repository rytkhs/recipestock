import { type FormEvent, useState } from "react";
import { sendEmailLoginCode, signInWithEmailCode, startGoogleLogin } from "../lib/auth";

export const LoginRoute = () => {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      await sendEmailLoginCode(email);
      setIsCodeSent(true);
    } catch {
      setError("ログインコードを送信できませんでした。");
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      await signInWithEmailCode(email, otp);
      window.location.assign("/recipes");
    } catch {
      setError("ログインできませんでした。");
    }
  };

  return (
    <section className="page login-page">
      <h1>ログイン</h1>
      <div className="login-panel">
        <button className="primary-button" type="button" onClick={() => void startGoogleLogin()}>
          Googleでログイン
        </button>

        <form className="login-form" onSubmit={isCodeSent ? handleVerifyCode : handleSendCode}>
          <label htmlFor="login-email">メールアドレス</label>
          <input
            id="login-email"
            autoComplete="email"
            inputMode="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          {isCodeSent ? (
            <>
              <label htmlFor="login-code">6桁コード</label>
              <input
                id="login-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                pattern="[0-9]{6}"
                required
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </>
          ) : null}

          <button className="secondary-button" type="submit">
            {isCodeSent ? "ログイン" : "コードを送信"}
          </button>
        </form>

        {error ? <p role="alert">{error}</p> : null}
      </div>
    </section>
  );
};
