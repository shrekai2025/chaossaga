# ChaosSaga - 新手引导与教学系统详细设计

> 版本: 1.0 | 更新日期: 2026-02-08

---

## 一、设计原则

```
┌─────────────────────────────────────────────────────────────────┐
│                    新手引导设计原则                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 边玩边学：在实际游戏中自然引入机制，不用长篇说明             │
│  2. 渐进披露：每次只教一个概念，复杂系统延后                     │
│  3. 安全空间：教学战斗不会失败，让玩家建立信心                   │
│  4. 叙事融合：教学与主线剧情融合，不打断沉浸感                   │
│  5. 可跳过：老玩家可跳过教学（但建议不跳）                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、引导阶段流程

```
┌─────────────────────────────────────────────────────────────────┐
│              新手引导完整流程 (约15-20分钟)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  阶段1: 角色创建 (2分钟)                                         │
│  ├── 输入名字 → 选择背景 → 简短世界观介绍                        │
│  └── 教学点: 境界概念、角色背景影响                               │
│                                                                 │
│  阶段2: 首次对话 (2分钟)                                         │
│  ├── 与阿海对话 → AI生成个性化欢迎 → 接第一个任务               │
│  └── 教学点: NPC交互、任务系统                                   │
│                                                                 │
│  阶段3: 首次战斗 (3分钟)                                         │
│  ├── 遭遇小珊瑚蟹 → 引导攻击 → 引导技能 → 引导道具             │
│  └── 教学点: 战斗操作、技能释放、HP/MP概念                       │
│                                                                 │
│  阶段4: 战利品 (1分钟)                                           │
│  ├── 获得掉落 → 打开背包 → 装备物品                             │
│  └── 教学点: 背包系统、装备系统                                   │
│                                                                 │
│  阶段5: 自由探索 (5分钟)                                         │
│  ├── 完成2-3场普通战斗 → 升级 → 学习新技能                      │
│  └── 教学点: 经验升级、技能学习、区域探索                        │
│                                                                 │
│  阶段6: 引导结束 (2分钟)                                         │
│  ├── 回NPC交任务 → 解锁完整功能 → 收到引导完成奖励              │
│  └── 教学点: 任务交付、图鉴、后续内容引导                        │
│                                                                 │
│  → 此后所有系统功能开放，高级系统(套装/声望等)在触及时弹提示     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、教学战斗设计

```typescript
// lib/game/tutorial-battle.ts

/** 教学战斗的特殊配置 */
interface TutorialBattleConfig {
  /** 敌人弱化（教学战斗敌人只有正常的50%属性） */
  enemyStatMultiplier: 0.5;
  
  /** 不会死亡（HP降到1时停止扣血） */
  preventDeath: true;
  
  /** 强制行动引导序列 */
  guidedActions: GuidedAction[];
  
  /** 教学完成后的奖励 */
  completionReward: { exp: number; gold: number; items: string[] };
}

interface GuidedAction {
  round: number;
  instruction: string;          // 界面提示文字
  highlightElement: string;     // 高亮的UI元素
  requiredAction: string;       // 要求的行动
  onComplete: string;           // 完成后的提示
}

const FIRST_BATTLE_TUTORIAL: TutorialBattleConfig = {
  enemyStatMultiplier: 0.5,
  preventDeath: true,
  guidedActions: [
    {
      round: 1,
      instruction: '点击「攻击」按钮对珊瑚蟹发起攻击！',
      highlightElement: '#btn-attack',
      requiredAction: 'attack',
      onComplete: '做得好！普通攻击不消耗MP，是最基础的战斗方式。',
    },
    {
      round: 2,
      instruction: '现在试试使用技能！点击「技能」然后选择「潮汐之力」。',
      highlightElement: '#btn-skill',
      requiredAction: 'skill',
      onComplete: '技能比普通攻击更强，但需要消耗MP。注意观察右下方的MP条！',
    },
    {
      round: 3,
      instruction: '你受伤了！使用背包里的「初级回复药」恢复HP。',
      highlightElement: '#btn-item',
      requiredAction: 'item',
      onComplete: '回复药是战斗中的保命手段，记得常备！',
    },
  ],
  completionReward: {
    exp: 50,
    gold: 30,
    items: ['healing_potion_basic', 'healing_potion_basic', 'healing_potion_basic'],
  },
};
```

---

## 四、渐进式功能解锁

| 解锁时机 | 新功能 | 弹窗提示 |
|----------|--------|----------|
| 角色创建完成 | 主界面、状态面板 | "欢迎来到ChaosSaga！" |
| 首次战斗完成 | 背包、装备栏 | "你获得了战利品！打开背包查看。" |
| 达到Lv.3 | 技能页面 | "你的力量在增长…查看可用技能！" |
| 完成首个任务 | 任务面板、NPC标记 | "任务系统已解锁！注意NPC头上的标记。" |
| 达到Lv.5 | 图鉴系统 | "图鉴系统开放！收集越多，你就越强。" |
| 首次获得套装件 | 套装面板 | "这件装备属于套装系列…" |
| 进入第二区域 | 区域地图 | "更广阔的世界在等着你！" |
| 达到Lv.10 | 境界突破界面 | "你感受到了瓶颈…也许是突破的时候了。" |

---

## 五、提示系统

```typescript
// lib/game/tips-system.ts

interface GameTip {
  id: string;
  triggerCondition: TipTrigger;
  message: string;
  showOnce: boolean;            // 是否只显示一次
  priority: number;             // 显示优先级
  dismissable: boolean;
}

type TipTrigger =
  | { type: 'level_reach'; level: number }
  | { type: 'first_action'; action: string }
  | { type: 'low_hp'; threshold: number }
  | { type: 'low_mp'; threshold: number }
  | { type: 'new_item_type'; itemType: string }
  | { type: 'consecutive_losses'; count: number }
  | { type: 'idle_time'; seconds: number };

const GAME_TIPS: GameTip[] = [
  {
    id: 'tip_low_hp',
    triggerCondition: { type: 'low_hp', threshold: 0.3 },
    message: '你的HP很低了！使用回复道具或选择防御来减少伤害。',
    showOnce: false,
    priority: 10,
    dismissable: true,
  },
  {
    id: 'tip_element_advantage',
    triggerCondition: { type: 'first_action', action: 'element_advantage_battle' },
    message: '属性克制可以增加30%伤害！水克火、火克风、风克土、土克水。',
    showOnce: true,
    priority: 8,
    dismissable: true,
  },
  {
    id: 'tip_consecutive_loss',
    triggerCondition: { type: 'consecutive_losses', count: 3 },
    message: '连续失败了…试试强化装备或更换技能搭配？也可以降低难度。',
    showOnce: false,
    priority: 9,
    dismissable: true,
  },
];
```

---

> 📝 本文档定义了 ChaosSaga 的新手引导系统。采用边玩边学的设计理念，通过6个阶段(约15-20分钟)自然引入所有核心机制。教学战斗有保护机制(不会死亡)，功能渐进式解锁避免信息过载。
