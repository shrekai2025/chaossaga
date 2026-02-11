# ChaosSaga - 环境效果机制详细设计

> 版本: 1.0 | 更新日期: 2026-02-08
> 对应 GDD 章节: 八、区域与关卡系统

---

## 一、环境四要素

```
┌─────────────────────────────────────────────────────────────────┐
│                    环境影响战斗的四要素                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  天气 ──┐                                                       │
│  时间 ──┤── 叠加计算 ──→ 最终环境效果 ──→ 应用到战斗             │
│  季节 ──┤                                                       │
│  地形 ──┘                                                       │
│                                                                 │
│  影响范围：属性加成/减少、技能效果、触发概率、掉落率             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、天气效果表

| 天气 | 属性影响 | 技能影响 | 特殊效果 | 出现概率 |
|------|----------|----------|----------|----------|
| 晴 | 无 | 光系+10% | 无 | 35% |
| 多云 | 无 | 无 | 无 | 20% |
| 雨 | 速度-5% | 水系+15%，火系-15% | 奇遇概率+5% | 15% |
| 大雨 | 速度-10% | 水系+25%，火系-25% | 雷系技能有5%概率连锁 | 8% |
| 雷暴 | 速度-15% | 水系+20%，风系+20%，火系-30% | 每回合5%概率随机雷击(全体) | 5% |
| 雪 | 速度-10% | 水系+10%，冰系效果+1回合 | 冰冻概率+10% | 7% |
| 大雪 | 速度-20% | 水系+20%，火系-20% | 每3回合冰冻判定(全体) | 3% |
| 迷雾 | 命中率-10% | 暗系+15% | 奇遇概率+30%，逃跑成功率+20% | 5% |
| 烈日 | 无 | 火系+20%，水系-10% | 每5回合灼热(扣2%HP) | 2% |

### 2.1 天气效果数据结构

```typescript
// lib/game/environment-effects.ts

interface WeatherEffect {
  id: string;
  name: string;
  statModifiers: {
    speed?: number;          // 百分比修正，如 -0.05 = -5%
    accuracy?: number;       // 命中率修正
  };
  elementModifiers: Record<string, number>;  // 属性伤害修正
  statusModifiers: {
    effectType?: string;     // 受影响的状态效果
    durationBonus?: number;  // 持续时间加成
    chanceBonus?: number;    // 触发概率加成
  }[];
  specialEffects: SpecialEnvironmentEffect[];
  adventureChanceBonus: number;
  weight: number;            // 出现权重
}

interface SpecialEnvironmentEffect {
  trigger: 'round_start' | 'round_end' | 'round_interval';
  interval?: number;         // round_interval 时的间隔
  effect: string;            // 效果类型
  target: 'all' | 'random_one' | 'all_enemies' | 'all_players';
  value: number;             // 效果数值
  chance: number;            // 触发概率
  description: string;
}

const WEATHER_EFFECTS: Record<string, WeatherEffect> = {
  '晴': {
    id: 'sunny', name: '晴',
    statModifiers: {},
    elementModifiers: { light: 0.1 },
    statusModifiers: [],
    specialEffects: [],
    adventureChanceBonus: 0,
    weight: 35,
  },
  '雨': {
    id: 'rain', name: '雨',
    statModifiers: { speed: -0.05 },
    elementModifiers: { water: 0.15, fire: -0.15 },
    statusModifiers: [],
    specialEffects: [],
    adventureChanceBonus: 0.05,
    weight: 15,
  },
  '雷暴': {
    id: 'thunderstorm', name: '雷暴',
    statModifiers: { speed: -0.15 },
    elementModifiers: { water: 0.2, wind: 0.2, fire: -0.3 },
    statusModifiers: [],
    specialEffects: [{
      trigger: 'round_end',
      effect: 'lightning_strike',
      target: 'random_one',
      value: 0.05, // 5% 最大HP
      chance: 0.05,
      description: '雷电随机劈下！',
    }],
    adventureChanceBonus: 0.2,
    weight: 5,
  },
  '迷雾': {
    id: 'fog', name: '迷雾',
    statModifiers: { accuracy: -0.1 },
    elementModifiers: { dark: 0.15 },
    statusModifiers: [],
    specialEffects: [],
    adventureChanceBonus: 0.3,
    weight: 5,
  },
};
```

---

## 三、时间效果表

| 时间 | 属性影响 | 技能影响 | 特殊效果 |
|------|----------|----------|----------|
| 黎明 (5:00-7:00) | 光系+15% | 暗系-10% | 奇遇概率+20% |
| 早晨 (7:00-11:00) | 无 | 无 | 经验获取+5% |
| 中午 (11:00-14:00) | 火系+10% | MP消耗+5% | 火系敌人活跃度+10% |
| 下午 (14:00-17:00) | 无 | 无 | 无 |
| 傍晚 (17:00-19:00) | 暗系+5%，光系+5% | 无 | 奇遇概率+10% |
| 夜晚 (19:00-23:00) | 暗系+15%，光系-10% | 速度+5% | 暗系敌人出现率+20% |
| 深夜 (23:00-5:00) | 暗系+25%，光系-20% | 速度+10% | 奇遇概率+25%，特殊敌人出现 |

---

## 四、季节效果表

| 季节 | 持续效果 | 技能影响 | 资源影响 | 特殊事件 |
|------|----------|----------|----------|----------|
| 春 | HP自然恢复+10% | 风系+10%，土系+10% | 草药掉落+20% | 精灵活跃 |
| 夏 | 火系敌人+20%出现率 | 火系+15%，水系+10% | 矿石掉落+15% | 海怪潮汐 |
| 秋 | 金币获取+10% | 暗系+10% | 装备掉落+10% | 商人增多 |
| 冬 | 速度-5% | 水系+15%，火系-10% | 药剂消耗+20% | 暴风雪 |

---

## 五、地形效果表

| 地形 | 属性影响 | 技能影响 | 特殊效果 |
|------|----------|----------|----------|
| 海岸/浅海 | 无 | 水系+20% | 海洋之子MP恢复+10%/回合 |
| 深海 | 速度-10%，非水系-10% | 水系+30% | 非水系呼吸判定(-2%HP/回合) |
| 森林 | 无 | 风系+15%，火系+10% | 逃跑成功率+15% |
| 山地 | 防御+10% | 土系+20% | 落石事件(5%/回合) |
| 城镇 | HP/MP恢复+20% | 无 | 无战斗(安全区) |
| 沙漠 | 速度-5%，MP消耗+10% | 火系+20%，土系+15% | 每3回合灼热(-3%HP) |
| 秘境 | 全属性+5% | 无 | 掉落品质提升一级 |

---

## 六、环境效果合成计算

```typescript
/**
 * 合成所有环境效果为最终战斗修正
 */
interface CombinedEnvironmentEffect {
  statModifiers: {
    speedPercent: number;
    accuracyPercent: number;
    hpRegenPercent: number;
    mpRegenPercent: number;
    defensePercent: number;
  };
  elementDamageModifiers: Record<string, number>;
  specialEffects: SpecialEnvironmentEffect[];
  expMultiplier: number;
  goldMultiplier: number;
  lootQualityBonus: number;
  adventureChanceBonus: number;
}

function calculateCombinedEnvironment(
  weather: string,
  timeOfDay: string,
  season: string,
  terrain: string
): CombinedEnvironmentEffect {
  const result: CombinedEnvironmentEffect = {
    statModifiers: { speedPercent: 0, accuracyPercent: 0, hpRegenPercent: 0, mpRegenPercent: 0, defensePercent: 0 },
    elementDamageModifiers: {},
    specialEffects: [],
    expMultiplier: 1.0,
    goldMultiplier: 1.0,
    lootQualityBonus: 0,
    adventureChanceBonus: 0,
  };

  // 叠加天气效果
  const w = WEATHER_EFFECTS[weather];
  if (w) {
    applyModifiers(result, w);
  }

  // 叠加时间效果
  const t = TIME_EFFECTS[timeOfDay];
  if (t) {
    applyModifiers(result, t);
  }

  // 叠加季节效果
  const s = SEASON_EFFECTS[season];
  if (s) {
    applyModifiers(result, s);
  }

  // 叠加地形效果
  const te = TERRAIN_EFFECTS[terrain];
  if (te) {
    applyModifiers(result, te);
  }

  return result;
}

/**
 * 应用环境效果到伤害计算
 */
function getEnvironmentDamageBonus(
  skillElement: string,
  environment: CombinedEnvironmentEffect
): number {
  return 1.0 + (environment.elementDamageModifiers[skillElement] ?? 0);
}
```

---

## 七、天气与时间推移

```typescript
/**
 * 天气随机变化（每次探索/战斗后有概率变化）
 */
function tickWeather(currentWeather: string): string {
  // 30%概率天气变化
  if (Math.random() > 0.3) return currentWeather;

  // 天气倾向于渐变（晴→多云→雨，而非晴→雷暴）
  const transitions: Record<string, Record<string, number>> = {
    '晴':   { '晴': 40, '多云': 40, '烈日': 10, '迷雾': 10 },
    '多云': { '多云': 30, '晴': 30, '雨': 25, '迷雾': 15 },
    '雨':   { '雨': 30, '大雨': 25, '多云': 30, '雷暴': 15 },
    '大雨': { '大雨': 25, '雨': 30, '雷暴': 30, '多云': 15 },
    '雷暴': { '雷暴': 20, '大雨': 40, '雨': 30, '多云': 10 },
    '雪':   { '雪': 35, '大雪': 25, '多云': 25, '晴': 15 },
    '大雪': { '大雪': 25, '雪': 40, '多云': 25, '迷雾': 10 },
    '迷雾': { '迷雾': 30, '多云': 30, '晴': 25, '雨': 15 },
    '烈日': { '烈日': 25, '晴': 50, '多云': 25 },
  };

  const options = transitions[currentWeather] ?? { '晴': 100 };
  return weightedRandomSelect(Object.entries(options).map(([w, weight]) => ({ value: w, weight })));
}

/**
 * 时间推移（每场战斗推进约30分钟游戏时间）
 */
const TIME_PROGRESSION = ['黎明', '早晨', '早晨', '中午', '下午', '下午', '傍晚', '夜晚', '夜晚', '深夜', '深夜', '黎明'];

function advanceTime(currentTime: string, battles: number = 1): string {
  const currentIdx = TIME_PROGRESSION.indexOf(currentTime);
  const newIdx = (currentIdx + battles) % TIME_PROGRESSION.length;
  return TIME_PROGRESSION[newIdx];
}
```

---

> 📝 本文档定义了 ChaosSaga 的完整环境效果系统。天气/时间/季节/地形四要素叠加计算，影响属性、技能伤害、特殊效果和奖励。天气支持自然渐变，时间随战斗推进。所有计算纯数值驱动。
