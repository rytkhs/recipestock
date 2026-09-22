import { Eye, EyeSlash } from "@phosphor-icons/react";
import { type ComponentProps, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

// 打った文字を見て確かめられるようにする。同じパスワードを2回打たせる欄の代わりにする。
export const PasswordInput = (props: Omit<ComponentProps<typeof InputGroupInput>, "type">) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <InputGroup>
      <InputGroupInput {...props} type={isVisible ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label="パスワードを表示"
          aria-pressed={isVisible}
          size="icon-xs"
          onClick={() => setIsVisible((current) => !current)}
        >
          {isVisible ? <EyeSlash weight="bold" /> : <Eye weight="bold" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
};
