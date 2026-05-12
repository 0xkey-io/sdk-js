import { AuthToggleButton } from "./index";
import { useZeroXKey } from "@0xkey-io/react-wallet-kit";
import { OAuthProviders } from "@0xkey-io/sdk-types";

interface SocialButtonProps {
  canRemoveAuthMethod: boolean;
  provider: OAuthProviders;
  logo: React.ReactNode;
}

export default function SocialButton({
  provider,
  logo,
  canRemoveAuthMethod,
}: SocialButtonProps) {
  const { user, handleAddOauthProvider, handleRemoveOauthProvider } =
    useZeroXKey();

  const existingProvider = user?.oauthProviders.find(
    (p) => p.providerName.toLowerCase() === provider.toLowerCase(),
  );

  return (
    <AuthToggleButton
      label={provider}
      icon={logo}
      isLinked={!!existingProvider}
      onAdd={() => handleAddOauthProvider({ providerName: provider })}
      canRemoveAuthMethod={canRemoveAuthMethod}
      onRemove={() => {
        existingProvider &&
          handleRemoveOauthProvider({
            providerId: existingProvider.providerId,
          });
      }}
    />
  );
}
