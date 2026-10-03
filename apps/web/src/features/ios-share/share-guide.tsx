import { type ReactNode } from "react";

/** 共有から取り込む手順の本文。 */
export const guideTextClass = "text-brand-muted text-sm leading-6";

/** 共有から取り込めることを、まだ知らない人に最初に伝える見出し。説明は端末ごとに違うので中身で渡す。 */
export const ShareIntro = ({ children }: { children: ReactNode }) => (
  <section className="grid gap-3">
    <h2 className="font-bold text-[21px] text-brand-walnut leading-normal">
      見つけたレシピを、
      <br />
      共有ボタンから保存
    </h2>
    {children}
  </section>
);
