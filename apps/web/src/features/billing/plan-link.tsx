import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 上限のエラーの横に置く、プランのページへの入口。
export const PlanLink = ({ variant = "outline" }: { variant?: "default" | "outline" }) => (
  <Link
    className={cn(buttonVariants({ size: "sm", variant }), "shrink-0 no-underline")}
    to="/settings/billing"
  >
    プランを見る
  </Link>
);
