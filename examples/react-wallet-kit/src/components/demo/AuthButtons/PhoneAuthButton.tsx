import { PhoneSVG } from "@/components/Svg";
import { AuthToggleButton } from "./index";
import { useZeroXKey } from "@0xkey-io/react-wallet-kit";

export default function PhoneAuthButton({
  canRemoveAuthMethod,
}: {
  canRemoveAuthMethod: boolean;
}) {
  const { user, handleAddPhoneNumber, handleRemoveUserPhoneNumber } =
    useZeroXKey();

  return (
    <AuthToggleButton
      label="SMS"
      icon={<PhoneSVG className="w-6 h-6" />}
      isLinked={!!user?.userPhoneNumber}
      onAdd={handleAddPhoneNumber}
      canRemoveAuthMethod={canRemoveAuthMethod}
      onRemove={() => {
        handleRemoveUserPhoneNumber({});
      }}
    />
  );
}
