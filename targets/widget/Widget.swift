import WidgetKit
import SwiftUI

// MARK: - 共有データモデル（JS側 ExtensionStorage.set("scoreWidgetData", JSON文字列) と一致させる）

struct ScoreWidgetData: Codable {
  var riskScore: Int
  var riskLabel: String
  var daysUntilCompetition: Int?
  var competitionName: String?
  var streak: Int
  var recoveryPhase: String?
  var recoveryDay: Int?
  var recoveryTotalDays: Int?
  var recoveryProgressPercent: Int?

  static let placeholder = ScoreWidgetData(
    riskScore: 18, riskLabel: "低リスク",
    daysUntilCompetition: 12, competitionName: "県総体・100m",
    streak: 18,
    recoveryPhase: "リハビリ期", recoveryDay: 14, recoveryTotalDays: 28, recoveryProgressPercent: 50
  )
}

func loadScoreWidgetData() -> ScoreWidgetData {
  let suite = UserDefaults(suiteName: "group.com.scorejapan.score")
  guard
    let json = suite?.string(forKey: "scoreWidgetData"),
    let data = json.data(using: .utf8),
    let decoded = try? JSONDecoder().decode(ScoreWidgetData.self, from: data)
  else {
    return .placeholder
  }
  return decoded
}

// 怪我リスクのスコア帯（app/(tabs)/index.tsx の buildRiskCfg と同じ閾値・色に揃える）
func riskColor(for score: Int) -> Color {
  switch score {
  case ...24:  return Color(hex: "#166534")
  case ...49:  return Color(hex: "#f59e0b")
  case ...74:  return Color(hex: "#f97316")
  default:     return Color(hex: "#E53935")
  }
}

extension Color {
  init(hex: String) {
    let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    self.init(
      red:   Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue:  Double(v & 0xFF) / 255
    )
  }
}

// MARK: - Timeline

struct ScoreEntry: TimelineEntry {
  let date: Date
  let data: ScoreWidgetData
}

struct ScoreProvider: TimelineProvider {
  func placeholder(in context: Context) -> ScoreEntry {
    ScoreEntry(date: Date(), data: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (ScoreEntry) -> Void) {
    completion(ScoreEntry(date: Date(), data: loadScoreWidgetData()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ScoreEntry>) -> Void) {
    let entry = ScoreEntry(date: Date(), data: loadScoreWidgetData())
    // アプリ側からreloadWidget()で明示的に更新するため、次回はそれまで固定表示でよい
    completion(Timeline(entries: [entry], policy: .never))
  }
}

// MARK: - 怪我リスクスコア（小）

struct RiskScoreWidgetView: View {
  let data: ScoreWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("怪我リスク")
        .font(.system(size: 11, weight: .bold))
        .foregroundColor(.secondary)

      HStack(alignment: .firstTextBaseline, spacing: 2) {
        Text("\(data.riskScore)")
          .font(.system(size: 34, weight: .black, design: .rounded))
          .foregroundColor(riskColor(for: data.riskScore))
        Text("/100")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.secondary)
      }

      Text(data.riskLabel)
        .font(.system(size: 11, weight: .bold))
        .foregroundColor(riskColor(for: data.riskScore))

      GeometryReader { geo in
        ZStack(alignment: .leading) {
          RoundedRectangle(cornerRadius: 3).fill(Color.gray.opacity(0.15))
          RoundedRectangle(cornerRadius: 3)
            .fill(riskColor(for: data.riskScore))
            .frame(width: geo.size.width * CGFloat(min(100, max(0, data.riskScore))) / 100)
        }
      }
      .frame(height: 6)

      Spacer(minLength: 0)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct RiskScoreWidget: Widget {
  let kind = "RiskScoreWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ScoreProvider()) { entry in
      RiskScoreWidgetView(data: entry.data)
        .containerBackground(.white, for: .widget)
    }
    .configurationDisplayName("怪我リスクスコア")
    .description("今日の怪我リスクスコアをホーム画面に表示します。")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - 大会までのカウントダウン（小）

struct CountdownWidgetView: View {
  let data: ScoreWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("次の大会まで")
        .font(.system(size: 11, weight: .bold))
        .foregroundColor(.secondary)

      if let days = data.daysUntilCompetition {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
          Text("\(days)")
            .font(.system(size: 34, weight: .black, design: .rounded))
            .foregroundColor(Color(hex: "#f97316"))
          Text("日")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(.secondary)
        }
        if let name = data.competitionName {
          Text(name)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(.secondary)
            .lineLimit(1)
        }
      } else {
        Text("予定なし")
          .font(.system(size: 15, weight: .bold))
          .foregroundColor(.secondary)
      }

      Spacer(minLength: 0)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct CountdownWidget: Widget {
  let kind = "CountdownWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ScoreProvider()) { entry in
      CountdownWidgetView(data: entry.data)
        .containerBackground(.white, for: .widget)
    }
    .configurationDisplayName("大会カウントダウン")
    .description("次の大会までの日数を表示します。")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - 連続記録ストリーク（小）

struct StreakWidgetView: View {
  let data: ScoreWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("連続記録")
        .font(.system(size: 11, weight: .bold))
        .foregroundColor(.secondary)

      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text("🔥")
          .font(.system(size: 26))
        Text("\(data.streak)")
          .font(.system(size: 34, weight: .black, design: .rounded))
          .foregroundColor(Color(hex: "#f43f5e"))
      }
      Text("日連続")
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(.secondary)

      Spacer(minLength: 0)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct StreakWidget: Widget {
  let kind = "StreakWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ScoreProvider()) { entry in
      StreakWidgetView(data: entry.data)
        .containerBackground(.white, for: .widget)
    }
    .configurationDisplayName("連続記録ストリーク")
    .description("練習記録が何日連続しているかを表示します。")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - 復帰プラン進捗（中）

struct RecoveryPlanWidgetView: View {
  let data: ScoreWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let phase = data.recoveryPhase, let day = data.recoveryDay, let total = data.recoveryTotalDays {
        Text("復帰プラン — \(phase)")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.secondary)

        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text("Day \(day)")
            .font(.system(size: 24, weight: .black, design: .rounded))
            .foregroundColor(Color(hex: "#8b5cf6"))
          Text("/ \(total)日")
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(.secondary)
        }

        GeometryReader { geo in
          ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 3).fill(Color.gray.opacity(0.15))
            RoundedRectangle(cornerRadius: 3)
              .fill(Color(hex: "#8b5cf6"))
              .frame(width: geo.size.width * CGFloat(min(100, max(0, data.recoveryProgressPercent ?? 0))) / 100)
          }
        }
        .frame(height: 6)
      } else {
        Text("復帰プラン")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.secondary)
        Text("進行中のプランはありません")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.secondary)
      }

      Spacer(minLength: 0)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct RecoveryPlanWidget: Widget {
  let kind = "RecoveryPlanWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ScoreProvider()) { entry in
      RecoveryPlanWidgetView(data: entry.data)
        .containerBackground(.white, for: .widget)
    }
    .configurationDisplayName("復帰プラン進捗")
    .description("怪我からの復帰プランの進捗状況を表示します。")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - 統合ウィジェット（大）

struct SummaryWidgetView: View {
  let data: ScoreWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("sCORE 今日のまとめ")
        .font(.system(size: 12, weight: .bold))
        .foregroundColor(.secondary)

      HStack(spacing: 0) {
        MiniStat(value: "\(data.riskScore)", label: "怪我リスク", color: riskColor(for: data.riskScore))
        MiniStat(
          value: data.daysUntilCompetition.map { "\($0)日" } ?? "—",
          label: "大会まで", color: Color(hex: "#f97316")
        )
        MiniStat(value: "🔥\(data.streak)", label: "連続記録", color: Color(hex: "#f43f5e"))
      }

      Divider()

      if let phase = data.recoveryPhase, let day = data.recoveryDay, let total = data.recoveryTotalDays {
        Text("復帰プラン: \(phase) Day\(day)/\(total)")
          .font(.system(size: 10.5, weight: .semibold))
          .foregroundColor(.secondary)
      } else if let name = data.competitionName {
        Text(name)
          .font(.system(size: 10.5))
          .foregroundColor(.secondary)
      }

      Spacer(minLength: 0)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct MiniStat: View {
  let value: String
  let label: String
  let color: Color

  var body: some View {
    VStack(spacing: 3) {
      Text(value)
        .font(.system(size: 20, weight: .heavy, design: .rounded))
        .foregroundColor(color)
      Text(label)
        .font(.system(size: 9.5, weight: .semibold))
        .foregroundColor(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity)
  }
}

struct SummaryWidget: Widget {
  let kind = "SummaryWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ScoreProvider()) { entry in
      SummaryWidgetView(data: entry.data)
        .containerBackground(.white, for: .widget)
    }
    .configurationDisplayName("今日のまとめ")
    .description("怪我リスク・大会まで・連続記録・コンディションをまとめて表示します。")
    .supportedFamilies([.systemLarge])
  }
}

// MARK: - Bundle

@main
struct SCOREWidgetBundle: WidgetBundle {
  var body: some Widget {
    RiskScoreWidget()
    CountdownWidget()
    StreakWidget()
    RecoveryPlanWidget()
    SummaryWidget()
  }
}
