"use client";

import { useState } from "react";
import Link from "next/link";
import { WastageModal, type BagItemOption, type WarehouseOption } from "./wastage-modal";
import { NewBagModal } from "./new-bag-modal";

export function BagInventoryActions({
  bagItems,
  warehouses,
}: {
  bagItems: BagItemOption[];
  warehouses: WarehouseOption[];
}) {
  const [showWastage, setShowWastage] = useState(false);
  const [showNewBag, setShowNewBag] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          prefetch={false}
          href="/vouchers/purchase"
          className="btn-outline text-brand-700 border-brand-300 hover:bg-brand-50"
        >
          🛒 + খালি বস্তা ক্রয়
        </Link>
        <button
          type="button"
          onClick={() => setShowWastage(true)}
          className="btn-outline text-amber-700 border-amber-300 hover:bg-amber-50"
        >
          ⚠️ + নষ্ট বস্তা এন্ট্রি
        </button>
        <button
          type="button"
          onClick={() => setShowNewBag(true)}
          className="btn-primary"
        >
          + নতুন বস্তা যোগ
        </button>
      </div>

      <WastageModal
        isOpen={showWastage}
        onClose={() => setShowWastage(false)}
        bagItems={bagItems}
        warehouses={warehouses}
      />

      <NewBagModal
        isOpen={showNewBag}
        onClose={() => setShowNewBag(false)}
      />
    </>
  );
}
