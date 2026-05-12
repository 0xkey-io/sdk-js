"use client";

import DemoPanel from "@/components/demo/DemoPanel";
import UserSettings from "@/components/demo/UserSettings";
import { Spinner } from "@/components/Spinners";
import { useScreenSize } from "@/utils";
import { faUserGear, faWallet } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  Button,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Transition,
} from "@headlessui/react";
import {
  AuthState,
  ClientState,
  useZeroXKey,
} from "@0xkey-io/react-wallet-kit";
import { SetStateAction, useEffect, useState } from "react";

export default function AuthPage() {
  const { handleLogin, clientState, authState } = useZeroXKey();

  const [selectedTabIndex, setSelectedTabIndex] = useState(1);

  useEffect(() => {
    if (
      clientState === ClientState.Ready &&
      authState === AuthState.Unauthenticated
    ) {
      handleLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientState]);

  const { isMobile } = useScreenSize();

  return (
    <div className="w-full flex items-center justify-center h-dvh">
      {authState === AuthState.Unauthenticated &&
        (clientState === undefined || clientState === ClientState.Loading ? (
          <Spinner className="size-48" strokeWidth={1} />
        ) : clientState === ClientState.Error ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span>An error has occurred.</span>
            <Button
              onClick={() => window.location.reload()}
              className="rounded-md border border-modal-background-dark/15 bg-white px-4 py-2 text-sm font-medium dark:border-modal-background-light/20 dark:bg-modal-background-dark"
            >
              Refresh page
            </Button>
          </div>
        ) : null)}
      <Transition
        appear
        show={authState === AuthState.Authenticated}
        leave="transition-all duration-200 ease-in absolute"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        {!isMobile ? (
          <div className="flex items-center justify-center gap-10 w-fit">
            <UserSettings />
            <DemoPanel />
          </div>
        ) : (
          <TabGroup
            onChange={(index: SetStateAction<number>) =>
              setSelectedTabIndex(index)
            }
            selectedIndex={selectedTabIndex}
          >
            <TabPanels className="flex justify-center items-center">
              <TabPanel className="w-[95%]">
                <UserSettings />
              </TabPanel>
              <TabPanel className="w-[95%]">
                <DemoPanel />
              </TabPanel>
            </TabPanels>
            <TabList className="backdrop-blur flex border-t border-t-icon-background-light dark:border-t-icon-background-dark items-center justify-evenly absolute bottom-0 h-16 w-full z-20">
              <Tab className="flex items-center justify-center flex-col group w-full">
                <FontAwesomeIcon
                  className="transition-colors text-icon-text-light dark:text-icon-text-dark group-data-selected:text-primary-light dark:group-data-selected:text-primary-dark text-xl"
                  icon={faUserGear}
                />
                <p>Account</p>
              </Tab>
              <Tab className="flex items-center justify-center flex-col group w-full">
                <FontAwesomeIcon
                  className="transition-colors text-icon-text-light dark:text-icon-text-dark group-data-selected:text-primary-light dark:group-data-selected:text-primary-dark text-xl"
                  icon={faWallet}
                />
                <p>Wallet</p>
              </Tab>
            </TabList>
          </TabGroup>
        )}
      </Transition>
    </div>
  );
}
