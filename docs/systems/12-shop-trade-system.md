# ChaosSaga - 商店与交易系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 十一、经济系统

---

## 一、商店类型

| 类型 | 说明 | 刷新规则 | NPC示例 |
|------|------|----------|---------|
| 固定商店 | 商品固定不变 | 不刷新 | 杂货商人 |
| 轮换商店 | 部分商品定期更换 | 每日/每周刷新 | 区域商人 |
| 限时商店 | 奇遇/事件触发 | 一次性 | 神秘商人 |
| 声望商店 | 需达到声望等级 | 声望解锁 | 势力商人 |
| 特殊商店 | 使用灵石购买 | 每周刷新 | 仙人商店 |

---

## 二、商店数据结构

```typescript
// lib/game/shop.ts

interface ShopConfig {
  shopId: string;
  name: string;
  npcId: string;
  type: 'fixed' | 'rotating' | 'timed' | 'reputation' | 'premium';
  
  /** 固定商品（始终在售） */
  fixedItems: ShopItem[];
  
  /** 轮换商品池 */
  rotatingPool?: {
    items: ShopItem[];
    displayCount: number;     // 每次展示多少个
    refreshInterval: 'daily' | 'weekly';
  };
  
  /** 声望要求 */
  reputationRequirement?: {
    factionId: string;
    minLevel: string;
  };
  
  /** 买入价格修正（基于好感度） */
  priceModifier: number;
}

interface ShopItem {
  itemId: string;
  basePrice: number;          // 基础售价（金币）
  currency: 'gold' | 'spiritStone'; // 货币类型
  stock: number;              // 库存（-1=无限）
  realmRequirement?: string;  // 境界要求
  reputationRequirement?: number; // 声望要求
  discountPercent?: number;   // 折扣百分比（限时优惠）
}
```

---

## 三、价格计算

```typescript
/**
 * 商品最终价格计算
 * 最终价格 = 基础价格 × 好感度修正 × 声望修正 × 折扣 × 季节修正
 */
function calculateFinalPrice(
  item: ShopItem,
  npcId: string,
  playerId: string,
  season: string
): number {
  let price = item.basePrice;

  // 好感度修正
  const affinity = getAffinityLevel(playerId, npcId);
  const affinityModifier = PRICE_MODIFIERS[affinity] ?? 1.0;
  price *= affinityModifier;

  // 声望修正
  const shopConfig = getShopConfig(npcId);
  if (shopConfig.reputationRequirement) {
    const repLevel = getReputationLevel(playerId, shopConfig.reputationRequirement.factionId);
    price *= getReputationPriceModifier(repLevel);
  }

  // 折扣
  if (item.discountPercent) {
    price *= (1 - item.discountPercent / 100);
  }

  // 季节修正（秋季商品略便宜）
  if (season === '秋') price *= 0.95;

  return Math.ceil(price); // 向上取整
}

/**
 * 物品卖出价格 = 基础价格 × 30%（固定回收比例）
 * 品质越高回收比例越好
 */
function calculateSellPrice(item: Item, enhanceLevel: number): number {
  const qualityMultiplier: Record<string, number> = {
    common: 0.25, uncommon: 0.30, rare: 0.35,
    epic: 0.40, legendary: 0.50, mythic: 0.60,
  };
  
  const baseRate = qualityMultiplier[item.quality] ?? 0.25;
  const enhanceBonus = enhanceLevel * 0.02; // 每强化等级+2%

  return Math.ceil(item.basePrice * (baseRate + enhanceBonus));
}
```

---

## 四、商店轮换机制

```typescript
/**
 * 每日/每周商店刷新
 */
async function refreshShop(shopId: string): Promise<ShopItem[]> {
  const config = getShopConfig(shopId);
  if (!config.rotatingPool) return config.fixedItems;

  const pool = config.rotatingPool;
  const selected: ShopItem[] = [];
  const available = [...pool.items];

  // 从池中不重复抽取
  for (let i = 0; i < pool.displayCount && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length);
    selected.push(available[idx]);
    available.splice(idx, 1);
  }

  // 保存本次轮换结果
  await saveShopRotation(shopId, selected);

  return [...config.fixedItems, ...selected];
}
```

---

## 五、商店示例配置

### 5.1 珊瑚渔村杂货店

```typescript
const CORAL_VILLAGE_SHOP: ShopConfig = {
  shopId: 'shop_coral_village',
  name: '珊瑚渔村杂货店',
  npcId: 'village_merchant',
  type: 'fixed',
  priceModifier: 1.0,
  fixedItems: [
    // 回复药
    { itemId: 'hp_potion_small',    basePrice: 30,  currency: 'gold', stock: -1 },
    { itemId: 'hp_potion_medium',   basePrice: 80,  currency: 'gold', stock: -1, realmRequirement: 'ocean' },
    { itemId: 'mp_potion_small',    basePrice: 25,  currency: 'gold', stock: -1 },
    // 材料
    { itemId: 'enhance_stone_basic', basePrice: 100, currency: 'gold', stock: 5 },
    // 基础装备
    { itemId: 'wooden_sword',       basePrice: 150, currency: 'gold', stock: 3 },
    { itemId: 'leather_armor',      basePrice: 200, currency: 'gold', stock: 3 },
  ],
};
```

### 5.2 渔民联盟声望商店

```typescript
const FISHERMEN_REP_SHOP: ShopConfig = {
  shopId: 'shop_fishermen_rep',
  name: '渔民联盟军需官',
  npcId: 'fishermen_quartermaster',
  type: 'reputation',
  priceModifier: 1.0,
  reputationRequirement: {
    factionId: 'fishermen_alliance',
    minLevel: 'friendly',
  },
  fixedItems: [
    // 友善可买
    { itemId: 'hp_potion_large',     basePrice: 200,  currency: 'gold', stock: -1, reputationRequirement: 500 },
    // 尊敬可买
    { itemId: 'coral_net_weapon',    basePrice: 2000, currency: 'gold', stock: 1, reputationRequirement: 2000 },
    { itemId: 'ocean_enhance_stone', basePrice: 500,  currency: 'gold', stock: 3, reputationRequirement: 2000 },
    // 崇敬可买
    { itemId: 'ocean_tide_helm',     basePrice: 5000, currency: 'gold', stock: 1, reputationRequirement: 5000 },
    // 崇拜可买
    { itemId: 'ahai_legacy_weapon',  basePrice: 15000, currency: 'gold', stock: 1, reputationRequirement: 10000 },
  ],
  rotatingPool: {
    items: [
      { itemId: 'rare_fish_bait',    basePrice: 50,   currency: 'gold', stock: 10 },
      { itemId: 'ocean_scroll',      basePrice: 300,  currency: 'gold', stock: 2 },
      { itemId: 'pearl_accessory',   basePrice: 1500, currency: 'gold', stock: 1 },
      { itemId: 'tide_skillbook',    basePrice: 3000, currency: 'gold', stock: 1, reputationRequirement: 5000 },
    ],
    displayCount: 3,
    refreshInterval: 'weekly',
  },
};
```

---

## 六、买卖交互流程

```
玩家                  前端                  后端
 │                     │                     │
 │── 打开商店 ─────────→│                     │
 │                     │── GET /api/shop/{id} ──→│
 │                     │                     │── 获取商店配置
 │                     │                     │── 检查声望/好感度
 │                     │                     │── 计算价格修正
 │                     │←── 商品列表+价格 ────│
 │←─ 显示商店界面 ─────│                     │
 │                     │                     │
 │── 购买物品 ─────────→│                     │
 │                     │── POST /api/shop/buy ─→│
 │                     │   {shopId, itemId}    │
 │                     │                     │── 验证库存/金币
 │                     │                     │── 扣除金币
 │                     │                     │── 添加到背包
 │                     │                     │── 减少库存
 │                     │←── 购买成功 ─────────│
 │←─ 更新显示 ─────────│                     │
 │                     │                     │
 │── 卖出物品 ─────────→│                     │
 │                     │── POST /api/shop/sell ─→│
 │                     │   {inventoryId}      │
 │                     │                     │── 计算回收价
 │                     │                     │── 增加金币
 │                     │                     │── 移除物品
 │                     │←── 卖出成功 ─────────│
 │←─ 更新显示 ─────────│                     │
```

---

> 📝 本文档定义了 ChaosSaga 的商店与交易系统。5种商店类型覆盖不同需求，价格受好感度/声望/季节多因素影响，轮换商店保持新鲜感。物品回收比例按品质差异化，防止经济失衡。
