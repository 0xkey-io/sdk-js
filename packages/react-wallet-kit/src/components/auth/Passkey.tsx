import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserLock } from "@fortawesome/free-solid-svg-icons";
import { ActionButton, BaseButton } from "../design/Buttons";

interface PasskeyButtonsProps {
  onLogin: () => void;
  onSignUp: () => void;
}

export function PasskeyButtons(props: PasskeyButtonsProps) {
  const { onLogin, onSignUp } = props;

  return (
    <div className="flex w-full flex-col gap-2.5">
      <ActionButton
        name="passkey-login-button"
        onClick={onLogin}
        className="flex h-10 w-full items-center justify-center gap-2 border-modal-background-dark/15 bg-button-light py-2.5 text-sm text-inherit dark:border-modal-background-light/20 dark:bg-button-dark dark:text-white"
      >
        <FontAwesomeIcon icon={faUserLock} className="shrink-0" />
        Log in with passkey
      </ActionButton>
      <BaseButton
        type="button"
        name="passkey-signup-link"
        onClick={onSignUp}
        className="w-full cursor-pointer border-none bg-transparent py-1 text-center text-sm font-medium text-primary-light hover:underline dark:text-primary-dark"
      >
        Sign up with passkey
      </BaseButton>
    </div>
  );
}
