# ChaosSaga - 会话状态管理详细设计

> 版本: 1.0 | 更新日期: 2026-02-08

---

## 一、状态管理架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    状态管理三层架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  L1 - 瞬时状态 (内存/Redux)                                      │
│  ├── UI状态、动画状态、当前选择                                    │
│  ├── 生命周期: 页面存在期间                                       │
│  └── 丢失影响: 无（刷新即恢复默认）                               │
│                                                                 │
│  L2 - 会话状态 (SessionStorage / Redis)                          │
│  ├── 当前战斗状态、探索进度、NPC对话上下文                        │
│  ├── 生命周期: 单次会话（标签页/30分钟超时）                      │
│  └── 丢失影响: 中（战斗需重新开始）                               │
│                                                                 │
│  L3 - 持久状态 (PostgreSQL / Prisma)                             │
│  ├── 玩家属性、装备、技能、任务进度、声望、金币                   │
│  ├── 生命周期: 永久                                               │
│  └── 丢失影响: 致命（不可丢失）                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、战斗状态持久化

### 2.1 战斗状态快照

```typescript
// lib/game/battle-state.ts

interface BattleSnapshot {
  battleId: string;
  playerId: string;
  
  // 战斗配置
  battleType: string;
  areaId: string;
  questId?: string;
  difficulty: number;
  
  // 当前状态
  round: number;
  playerState: CombatEntitySnapshot;
  enemies: CombatEntitySnapshot[];
  
  // 历史记录
  actionHistory: ActionRecord[];
  narrativeHistory: string[];
  
  // 环境
  environmentEffect: string;
  
  // 时间戳
  createdAt: Date;
  lastUpdatedAt: Date;
  
  // 状态标记
  status: 'active' | 'paused' | 'finished';
}

interface CombatEntitySnapshot {
  id: string;
  name: string;
  currentHp: number;
  maxHp: number;
  currentMp: number;
  maxMp: number;
  statusEffects: StatusEffectSnapshot[];
  skillCooldowns: Record<string, number>;
}
```

### 2.2 断线恢复机制

```typescript
/**
 * 战斗断线恢复流程
 */
async function resumeBattle(playerId: string): Promise<BattleResumeResult> {
  // 1. 查找未完成的战斗
  const snapshot = await findActiveBattle(playerId);
  
  if (!snapshot) {
    return { hasActiveBattle: false };
  }

  // 2. 检查是否超时（超过30分钟的战斗作废）
  const elapsed = Date.now() - snapshot.lastUpdatedAt.getTime();
  if (elapsed > 30 * 60 * 1000) {
    await expireBattle(snapshot.battleId);
    return {
      hasActiveBattle: false,
      message: '你的战斗因长时间中断已结束。',
    };
  }

  // 3. 恢复战斗状态
  const battleState = restoreBattleFromSnapshot(snapshot);
  
  return {
    hasActiveBattle: true,
    battleState,
    message: `战斗恢复中...当前第${snapshot.round}回合。`,
  };
}

/**
 * 每次行动后保存快照
 */
async function saveBattleSnapshot(state: BattleState): Promise<void> {
  const snapshot = createSnapshot(state);
  
  // 使用Redis快速存储（有TTL自动过期）
  await redis.set(
    `battle:${state.battleId}`,
    JSON.stringify(snapshot),
    'EX', 1800 // 30分钟过期
  );
  
  // 同时异步写入DB（用于数据分析）
  saveBattleLogAsync(snapshot);
}
```

---

## 三、离线保护机制

```typescript
/**
 * 战斗中断时的保护性结算
 * 场景: 玩家关闭浏览器/网络断开/服务器重启
 */
async function handleBattleDisconnect(playerId: string): Promise<void> {
  const snapshot = await findActiveBattle(playerId);
  if (!snapshot) return;

  // 根据当前战斗进度决定处理方式
  const playerHpPercent = snapshot.playerState.currentHp / snapshot.playerState.maxHp;
  const totalEnemyHp = snapshot.enemies.reduce((sum, e) => sum + e.currentHp, 0);
  const totalEnemyMaxHp = snapshot.enemies.reduce((sum, e) => sum + e.maxHp, 0);
  const enemyHpPercent = totalEnemyHp / totalEnemyMaxHp;

  if (playerHpPercent > 0.5 && enemyHpPercent < 0.3) {
    // 玩家优势明显 → 判定胜利，给予70%奖励
    await settleBattle(snapshot, 'victory', 0.7);
  } else if (playerHpPercent < 0.2) {
    // 玩家劣势 → 判定撤退，无惩罚
    await settleBattle(snapshot, 'escape', 0);
  } else {
    // 胶着状态 → 暂停，30分钟内可恢复
    await pauseBattle(snapshot);
  }
}
```

---

## 四、数据同步策略

### 4.1 关键操作即时持久化

```typescript
/** 必须立即写入数据库的操作 */
const IMMEDIATE_PERSIST_ACTIONS = [
  'player_create',        // 创建角色
  'battle_end',           // 战斗结束（奖励结算）
  'quest_complete',       // 任务完成
  'item_purchase',        // 购买物品
  'equipment_enhance',    // 装备强化
  'realm_breakthrough',   // 境界突破
  'skill_learn',          // 学习技能
  'gold_change',          // 金币变化
];
```

### 4.2 批量延迟持久化

```typescript
/** 可以批量/延迟写入的操作 */
const BATCH_PERSIST_ACTIONS = [
  'collection_discover',  // 图鉴发现
  'npc_affinity_change', // NPC好感度变化
  'reputation_change',   // 声望变化
  'battle_log',          // 战斗日志
  'adventure_log',       // 奇遇日志
];

/**
 * 批量持久化器
 * 每30秒或累积10条变更时写入
 */
class BatchPersister {
  private buffer: PersistAction[] = [];
  private flushInterval = 30000;
  private maxBufferSize = 10;

  add(action: PersistAction): void {
    this.buffer.push(action);
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];
    
    // 批量事务写入
    await prisma.$transaction(
      batch.map(action => action.toPrismaOperation())
    );
  }
}
```

---

## 五、前端状态管理

```typescript
// 前端状态设计（React Context / Zustand）

interface GameState {
  // 玩家基础状态（从服务端加载，战斗结算后更新）
  player: PlayerState | null;
  
  // 当前战斗状态（会话级别）
  activeBattle: BattleState | null;
  
  // UI状态
  ui: {
    currentPage: string;
    isLoading: boolean;
    notifications: Notification[];
    tutorialStep: number | null;
  };
}

/**
 * 页面可见性处理
 * 用户切走时暂停，切回时检查恢复
 */
function setupVisibilityHandler(): void {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      // 页面不可见 → 记录时间戳
      sessionStorage.setItem('lastActiveAt', Date.now().toString());
    } else {
      // 页面恢复可见
      const lastActive = parseInt(sessionStorage.getItem('lastActiveAt') ?? '0');
      const elapsed = Date.now() - lastActive;
      
      if (elapsed > 5 * 60 * 1000) {
        // 超过5分钟 → 重新同步状态
        await syncPlayerState();
      }
      
      if (elapsed > 30 * 60 * 1000) {
        // 超过30分钟 → 检查战斗是否过期
        await checkBattleTimeout();
      }
    }
  });
}
```

---

> 📝 本文档定义了 ChaosSaga 的状态管理系统。三层架构（瞬时/会话/持久）确保数据安全，战斗支持断线恢复（30分钟内），离线保护机制根据战况智能结算。
