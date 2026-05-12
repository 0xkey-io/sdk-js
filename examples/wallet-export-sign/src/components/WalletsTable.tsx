import Image from "next/image";
import * as React from "react";
import { Dispatch, SetStateAction } from "react";
import cx from "classnames";
import { useRouter } from "next/router";

import styles from "../pages/index.module.css";

// We can pull this import from @0xkey-io/sdk-browser, @0xkey-io/sdk-server, or @0xkey-io/http.
// Electing to import from @0xkey-io/sdk-server as it's the only one we install for this example.
import { ZeroXKeyApiTypes } from "@0xkey-io/sdk-server";

type TWallet = ZeroXKeyApiTypes["v1Wallet"];

type WalletsTableProps = {
  wallets: TWallet[];
  setSelectedWallet: Dispatch<SetStateAction<string | null>>;
  setIsExportModalOpen: Dispatch<SetStateAction<boolean>>;
};

export function WalletsTable(props: WalletsTableProps) {
  const router = useRouter();

  const openExportModal = (walletId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click when clicking export button
    props.setSelectedWallet(walletId);
    props.setIsExportModalOpen(true);
  };

  const navigateToWalletDetails = (walletId: string) => {
    router.push(`/wallet/${walletId}`);
  };

  return (
    <div>
      <table className={styles.table}>
        <thead className={styles.tableHeader}>
          <tr>
            <th className={cx(styles.tableHeaderCell, styles.exportCol)}></th>
            <th className={cx(styles.tableHeaderCell, styles.walletNameCol)}>
              Wallet name
            </th>
            <th className={cx(styles.tableHeaderCell, styles.walletIdCol)}>
              Wallet ID
            </th>
          </tr>
        </thead>
        <tbody>
          {props.wallets.length > 0 ? (
            props.wallets.map((val, key) => {
              return (
                <tr
                  className={cx(styles.tableRow, styles.tableRowClickable)}
                  key={key}
                  onClick={() => navigateToWalletDetails(val.walletId)}
                >
                  <td className={styles.cell}>
                    <button
                      className={styles.exportButton}
                      onClick={(e) => {
                        openExportModal(val.walletId, e);
                      }}
                    >
                      <Image
                        src="/export.svg"
                        alt="Export"
                        width={12}
                        height={12}
                        priority
                      />
                    </button>
                  </td>
                  <td className={styles.cell}>
                    <p>{val.walletName}</p>
                  </td>
                  <td className={styles.cell}>
                    <p className={styles.idCell}>{val.walletId}</p>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr className={cx(styles.tableRow, styles.noWallets)}>
              <td colSpan={3}>
                <p>You have not created any wallets.</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
