import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faApple,
  faDiscord,
  faFacebook,
  faGoogle,
  faXTwitter,
} from "@fortawesome/free-brands-svg-icons";
import { OtpType, type WalletProvider } from "@0xkey-io/core";
import { faEllipsisH, faFingerprint } from "@fortawesome/free-solid-svg-icons";
import clsx from "clsx";
import { OAuthButton } from "./OAuth";
import { EmailInput } from "./Email";
import { OrSeparator } from "./OrSeparator";
import { OtpVerification } from "./OTP";
import { PhoneNumberInput } from "./Phone";
import { ActionPage } from "./Action";
import { PasskeyButtons } from "./Passkey";
import { Spinner } from "../design/Spinners";
import {
  ExternalWalletSelector,
  WalletAuthButton,
  WalletConnectScreen,
} from "./Wallet";
import { DeveloperError } from "../design/Failure";
import { useModal } from "../../providers/modal/Hook";
import { useZeroXKey } from "../../providers/client/Hook";
import { ClientState } from "../../types/base";
import { isWalletConnect } from "../../utils/utils";

type AuthComponentProps = {
  sessionKey?: string | undefined;
  logo?: string | undefined;
  logoClassName?: string | undefined;
  title?: string | undefined;
};

export function AuthComponent({
  sessionKey,
  logo,
  logoClassName,
  title,
}: AuthComponentProps) {
  const {
    config,
    clientState,
    handleGoogleOauth,
    handleAppleOauth,
    handleFacebookOauth,
    handleXOauth,
    handleDiscordOauth,
    initOtp,
    loginWithPasskey,
    signUpWithPasskey,
    loginOrSignupWithWallet,
    disconnectWalletAccount,
  } = useZeroXKey();
  const { pushPage, isMobile, openSheet } = useModal();

  if (!config || clientState === ClientState.Loading) {
    // Don't check ClientState.Error here. We already check in the modal root
    return (
      <div className="flex flex-col items-center w-96 py-5">
        <Spinner strokeWidth={2} className="w-48 h-48" />
      </div>
    );
  }

  const { methods = {}, methodOrder = [], oauthOrder = [] } = config.auth || {};

  const handleEmailSubmit = async (email: string) => {
    try {
      const { otpId, otpEncryptionTargetBundle } = await initOtp({
        otpType: OtpType.Email,
        contact: email,
      });
      pushPage({
        key: "Verify OTP",
        content: (
          <OtpVerification
            contact={email}
            otpId={otpId}
            otpEncryptionTargetBundle={otpEncryptionTargetBundle}
            otpType={OtpType.Email}
            otpLength={
              config.auth?.otpLength !== undefined
                ? Number(config.auth.otpLength)
                : undefined
            }
            alphanumeric={config.auth?.otpAlphanumeric}
            {...(sessionKey && { sessionKey })}
          />
        ),
        showTitle: false,
      });
    } catch (error) {
      throw new Error(`Error initializing OTP: ${error}`);
    }
  };

  const handlePhoneSubmit = async (phone: string, formattedPhone: string) => {
    try {
      const { otpId, otpEncryptionTargetBundle } = await initOtp({
        otpType: OtpType.Sms,
        contact: phone,
      });
      pushPage({
        key: "Verify OTP",
        content: (
          <OtpVerification
            contact={phone}
            // Pass in the formatted phone number seperately. In the case that some weird formatting occurs, we don't want to send it into the initOtp request
            formattedContact={formattedPhone}
            otpId={otpId}
            otpEncryptionTargetBundle={otpEncryptionTargetBundle}
            otpType={OtpType.Sms}
            otpLength={
              config.auth?.otpLength !== undefined
                ? Number(config.auth.otpLength)
                : undefined
            }
            alphanumeric={config.auth?.otpAlphanumeric}
            {...(sessionKey && { sessionKey })}
          />
        ),
        showTitle: false,
      });
    } catch (error) {
      throw new Error(`Error initializing OTP: ${error}`);
    }
  };

  const handlePasskeyLogin = () => {
    pushPage({
      key: "Passkey Login",
      content: (
        <ActionPage
          title="Authenticating with passkey..."
          action={async () => {
            await loginWithPasskey({
              ...(sessionKey && { sessionKey: sessionKey }),
            });
          }}
          icon={<FontAwesomeIcon size="3x" icon={faFingerprint} />}
        />
      ),
      showTitle: false,
    });
  };

  const handlePasskeySignUp = () => {
    pushPage({
      key: "Passkey Sign Up",
      content: (
        <ActionPage
          title="Creating account with passkey..."
          action={async () => {
            await signUpWithPasskey({
              ...(sessionKey && { sessionKey: sessionKey }),
            });
          }}
          icon={<FontAwesomeIcon size="3x" icon={faFingerprint} />}
        />
      ),
      showTitle: false,
    });
  };

  const handleGoogle = async () => {
    pushPage({
      key: "Google OAuth",
      content: (
        <ActionPage
          title="Authenticating with Google..."
          action={() =>
            handleGoogleOauth({
              additionalState: {
                openModal: "true",
                ...(sessionKey && { sessionKey }),
              }, // Tell the provider to reopen the auth modal and show the loading state
            })
          }
          icon={<FontAwesomeIcon size="3x" icon={faGoogle} />}
        />
      ),
      showTitle: false,
    });
  };

  const handleApple = async () => {
    pushPage({
      key: "Apple OAuth",
      content: (
        <ActionPage
          title="Authenticating with Apple..."
          action={() =>
            handleAppleOauth({
              additionalState: {
                openModal: "true",
                ...(sessionKey && { sessionKey }),
              }, // Tell the provider to reopen the auth modal and show the loading state
            })
          }
          icon={<FontAwesomeIcon size="3x" icon={faApple} />}
        />
      ),
      showTitle: false,
    });
  };

  const handleFacebook = async () => {
    pushPage({
      key: "Facebook OAuth",
      content: (
        <ActionPage
          title="Authenticating with Facebook..."
          action={() =>
            handleFacebookOauth({
              additionalState: {
                openModal: "true",
                ...(sessionKey && { sessionKey }),
              }, // Tell the provider to reopen the auth modal and show the loading state
            })
          }
          icon={<FontAwesomeIcon size="3x" icon={faFacebook} />}
        />
      ),
      showTitle: false,
    });
  };

  const handleX = async () => {
    pushPage({
      key: "X OAuth",
      content: (
        <ActionPage
          title="Authenticating with X..."
          action={() =>
            handleXOauth({
              additionalState: {
                openModal: "true",
                ...(sessionKey && { sessionKey }),
              }, // Tell the provider to reopen the auth modal and show the loading state
            })
          }
          icon={<FontAwesomeIcon size="3x" icon={faXTwitter} />}
        />
      ),
      showTitle: false,
    });
  };

  const handleDiscord = async () => {
    pushPage({
      key: "Discord OAuth",
      content: (
        <ActionPage
          title="Authenticating with Discord..."
          action={() =>
            handleDiscordOauth({
              additionalState: {
                openModal: "true",
                ...(sessionKey && { sessionKey }),
              }, // Tell the provider to reopen the auth modal and show the loading state
            })
          }
          icon={<FontAwesomeIcon size="3x" icon={faDiscord} />}
        />
      ),
      showTitle: false,
    });
  };

  const handleWalletLoginOrSignup = async (provider: WalletProvider) => {
    pushPage({
      key: "Wallet Login/Signup",
      content: (
        <ActionPage
          title={`Authenticating with ${provider.info.name}...`}
          action={async () => {
            await loginOrSignupWithWallet({
              walletProvider: provider,
              ...(sessionKey && { sessionKey: sessionKey }),
            });
          }}
          icon={
            <img
              className="size-11 rounded-full"
              src={provider.info.icon || ""}
            />
          }
        />
      ),
      showTitle: false,
    });
  };

  const handleSelect = async (provider: WalletProvider) => {
    // this is a wallet connect provider, so we need to show the WalletConnect screen
    if (isWalletConnect(provider)) {
      // for WalletConnect we route to a dedicated screen
      // to handle the connection process, as it requires a different flow (pairing via QR code or deep link)
      pushPage({
        key: "Connect WalletConnect",
        content: (
          <WalletConnectScreen
            provider={provider}
            onAction={async (provider) => {
              await loginOrSignupWithWallet({
                walletProvider: provider,
                ...(sessionKey && { sessionKey: sessionKey }),
              });
            }}
            onDisconnect={async (provider) => {
              await disconnectWalletAccount(provider);
            }}
            successPageDuration={undefined}
          />
        ),
      });
      return;
    }

    // this is a regular wallet provider, so we can just select it
    await handleWalletLoginOrSignup(provider);
  };

  const handleShowWalletSelector = async () => {
    try {
      pushPage({
        key: "Select wallet provider",
        content: <ExternalWalletSelector onSelect={handleSelect} />,
      });
    } catch (error) {
      throw new Error(`Error fetching wallet providers: ${error}`);
    }
  };

  const oauthButtonMap: Record<string, JSX.Element | null> = {
    google: methods.googleOauthEnabled ? (
      <OAuthButton
        key="google"
        name="Google"
        iconOnly
        icon={
          <FontAwesomeIcon
            icon={faGoogle}
            className="text-lg text-[#4285F4] dark:text-white"
          />
        }
        onClick={handleGoogle}
      />
    ) : null,
    apple: methods.appleOauthEnabled ? (
      <OAuthButton
        key="apple"
        name="Apple"
        iconOnly
        icon={
          <FontAwesomeIcon
            icon={faApple}
            className="text-lg text-neutral-900 dark:text-white"
          />
        }
        onClick={handleApple}
      />
    ) : null,
    facebook: methods.facebookOauthEnabled ? (
      <OAuthButton
        key="facebook"
        name="Facebook"
        iconOnly
        icon={
          <FontAwesomeIcon
            icon={faFacebook}
            className="text-lg text-[#1877F2] dark:text-white"
          />
        }
        onClick={handleFacebook}
      />
    ) : null,
    x: methods.xOauthEnabled ? (
      <OAuthButton
        key="x"
        name="X"
        iconOnly
        icon={
          <FontAwesomeIcon
            icon={faXTwitter}
            className="text-lg text-neutral-900 dark:text-white"
          />
        }
        onClick={handleX}
      />
    ) : null,
    discord: methods.discordOauthEnabled ? (
      <OAuthButton
        key="discord"
        name="Discord"
        iconOnly
        icon={
          <FontAwesomeIcon
            icon={faDiscord}
            className="text-lg text-[#5865F2] dark:text-white"
          />
        }
        onClick={handleDiscord}
      />
    ) : null,
  };

  const oauthButtonsList = oauthOrder
    .map((provider) => oauthButtonMap[provider])
    .filter(Boolean) as JSX.Element[];

  const oauthButtonRow = (buttons: JSX.Element[]) => (
    <div className="flex w-full flex-row flex-wrap items-center justify-center gap-2">
      {buttons}
    </div>
  );

  const oauthBlockInner =
    oauthButtonsList.length > 0 && oauthButtonsList.length <= 5
      ? oauthButtonRow(oauthButtonsList)
      : oauthButtonsList.length > 0
        ? oauthButtonRow([
            ...oauthButtonsList.slice(0, 4),
            <OAuthButton
              key="more"
              name="More"
              iconOnly
              icon={<FontAwesomeIcon icon={faEllipsisH} />}
              onClick={() =>
                openSheet({
                  key: "Select a social method",
                  content: (
                    <div className="flex h-full w-full flex-wrap items-center justify-center gap-2">
                      {oauthButtonsList.map((button, i) => (
                        <div key={i} className="shrink-0">
                          {button}
                        </div>
                      ))}
                    </div>
                  ),
                })
              }
            />,
          ])
        : null;

  const oauthBlock = oauthBlockInner ? (
    <div className="flex w-full flex-col">{oauthBlockInner}</div>
  ) : null;

  // -- Individual Auth Method Components --
  const methodComponents: Record<string, JSX.Element | null> = {
    socials: oauthBlock,
    email: methods.emailOtpAuthEnabled ? (
      <EmailInput onContinue={handleEmailSubmit} />
    ) : null,
    sms: methods.smsOtpAuthEnabled ? (
      <PhoneNumberInput onContinue={handlePhoneSubmit} />
    ) : null,
    passkey: methods.passkeyAuthEnabled ? (
      <PasskeyButtons
        onLogin={handlePasskeyLogin}
        onSignUp={handlePasskeySignUp}
      />
    ) : null,
    wallet: methods.walletAuthEnabled ? (
      <WalletAuthButton onContinue={handleShowWalletSelector} />
    ) : null,
  };

  // -- Final Rendering Order --
  const rendered = methodOrder
    .map((key) => methodComponents[key])
    .filter(Boolean);

  return (
    <div
      className={clsx(
        "flex flex-col items-center",
        isMobile ? "w-full" : "w-[360px]",
      )}
    >
      {config.authProxyConfigId ? (
        rendered.length > 0 ? (
          <>
            <div
              className={clsx(
                "mb-4 flex w-full flex-col items-center",
                logo ? "mt-3" : "mt-4",
              )}
            >
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  className={`mt-3 h-fit max-h-16 w-fit max-w-32 object-contain ${logoClassName ?? ""}`}
                />
              ) : null}
              <h1
                className={clsx(
                  "text-center text-xl font-semibold leading-tight text-inherit",
                  logo ? "mt-4" : "mt-0",
                )}
              >
                {title ?? "Welcome back"}
              </h1>
              <p className="mt-1 text-center text-sm text-icon-text-light/60 dark:text-icon-text-dark/60">
                Log in or create your account
              </p>
            </div>
            {rendered.map((component, index) => (
              <div key={index} className="w-full">
                {index > 0 && <OrSeparator />}
                {component}
              </div>
            ))}
          </>
        ) : (
          <DeveloperError
            developerTitle="No Auth Methods Enabled"
            developerMessages={[
              "You are using ZeroXKey's Auth Proxy, but no auth methods are enabled.",
              "To use this modal, you must enable auth methods within the ZeroXKey dashboard.",
              "If you disabled autoFetchWalletKitConfig in the ZeroXKeyProvider, please ensure that you are passing in the correct auth methods in the ZeroXKeyProvider's auth config.",
            ]}
            userMessages={["No authentication methods are available."]}
          />
        )
      ) : (
        <DeveloperError
          developerTitle="Proxy not Enabled"
          developerMessages={[
            "You have not passed in authProxyConfigId into the ZeroXKeyProvider.",
            "To use this modal, you must be using ZeroXKey's Auth Proxy.",
            "Please enable it in the ZeroXKey dashboard and pass in the authProxyConfigId into the ZeroXKeyProvider.",
          ]}
          // Users should never see this message ever. We should give a reward for anyone who does see this.
          userMessages={["You touched fuzzy.... and got dizzy."]}
        />
      )}

      <div className="mt-5 max-w-sm px-1 text-center text-xs leading-relaxed text-icon-text-light/60 dark:text-icon-text-dark/60">
        Secured by 0xkey
      </div>
    </div>
  );
}
