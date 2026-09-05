//
//  Widget.swift
//  sCORE Widget Extension
//
//  iOS 17+
//

import WidgetKit
import SwiftUI
import UIKit

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
    riskScore: 32, riskLabel: "要注意",
    daysUntilCompetition: 14, competitionName: "県高校総体",
    streak: 18,
    recoveryPhase: "リハビリ期", recoveryDay: 12, recoveryTotalDays: 30, recoveryProgressPercent: 40
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

// MARK: - Timeline Entry

struct ScoreWidgetEntry: TimelineEntry {
    let date: Date
    let data: ScoreWidgetData
}

// MARK: - Provider

struct ScoreWidgetProvider: TimelineProvider {

    // MARK: Preview

    func placeholder(in context: Context) -> ScoreWidgetEntry {
        ScoreWidgetEntry(date: Date(), data: .placeholder)
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (ScoreWidgetEntry) -> Void
    ) {
        completion(ScoreWidgetEntry(date: Date(), data: loadScoreWidgetData()))
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<ScoreWidgetEntry>) -> Void
    ) {
        let entry = ScoreWidgetEntry(date: Date(), data: loadScoreWidgetData())

        // アプリ側からreloadWidget()で明示的に更新するのが基本だが、
        // 万一reloadが飛ばなかった場合の保険として30分後にも再取得する
        let nextUpdate = Calendar.current.date(
            byAdding: .minute,
            value: 30,
            to: Date()
        ) ?? Date().addingTimeInterval(1800)

        completion(
            Timeline(
                entries: [entry],
                policy: .after(nextUpdate)
            )
        )
    }
}


// MARK: - Design System

enum ScoreDesign {

    // ブランド
    static let green = Color(hex: "166534")

    // Risk colors
    static let riskGreen = Color(hex: "166534")
    static let riskAmber = Color(hex: "F59E0B")
    static let riskOrange = Color(hex: "F97316")
    static let riskRed = Color(hex: "E53935")

    // Accent
    static let mint = Color(hex: "6EE7B7")
    static let blue = Color(hex: "60A5FA")
    static let gold = Color(hex: "D4A84B")

    // Background
    static let background = Color(
        light: "F4F5F2",
        dark: "0B110F"
    )

    static let surface = Color(
        light: "FFFFFF",
        dark: "111A17"
    )

    static let surfaceSecondary = Color(
        light: "E9ECE8",
        dark: "17211E"
    )

    static let primaryText = Color(
        light: "111513",
        dark: "F3F7F4"
    )

    static let secondaryText = Color(
        light: "68716C",
        dark: "9BA7A0"
    )

    static let tertiaryText = Color(
        light: "8A928D",
        dark: "69756E"
    )

    static func riskColor(_ score: Int) -> Color {
        switch score {
        case 0...24:
            return riskGreen
        case 25...49:
            return riskAmber
        case 50...74:
            return riskOrange
        default:
            return riskRed
        }
    }

    static func riskGradient(_ score: Int) -> LinearGradient {
        let color = riskColor(score)

        return LinearGradient(
            colors: [
                color.opacity(0.75),
                color
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }
}


// MARK: - Color Hex Helper

extension Color {

    init(hex: String) {

        let hex = hex.trimmingCharacters(
            in: CharacterSet.alphanumerics.inverted
        )

        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)

        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255

        self.init(
            red: r,
            green: g,
            blue: b
        )
    }

    init(light: String, dark: String) {

        self.init(
            UIColor {
                $0.userInterfaceStyle == .dark
                    ? UIColor(Color(hex: dark))
                    : UIColor(Color(hex: light))
            }
        )
    }
}


// MARK: - Shared Components

struct ScoreLabel: View {

    let icon: String
    let title: String

    var body: some View {

        HStack(spacing: 7) {

            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(ScoreDesign.mint)

            Text(title)
                .font(
                    .system(
                        size: 12,
                        weight: .semibold,
                        design: .rounded
                    )
                )
                .foregroundStyle(ScoreDesign.secondaryText)
        }
    }
}


// MARK: - Risk Progress Bar

struct RiskProgressBar: View {

    let score: Int

    var body: some View {

        GeometryReader { proxy in

            ZStack(alignment: .leading) {

                Capsule()
                    .fill(ScoreDesign.surfaceSecondary)

                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [
                                ScoreDesign.riskGreen,
                                ScoreDesign.riskAmber,
                                ScoreDesign.riskOrange,
                                ScoreDesign.riskRed
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(
                        width: max(
                            6,
                            proxy.size.width * CGFloat(score) / 100
                        )
                    )
            }
        }
        .frame(height: 5)
    }
}


// MARK: - 1. Risk Score Widget

struct RiskScoreWidgetView: View {

    let entry: ScoreWidgetEntry

    var data: ScoreWidgetData {
        entry.data
    }

    private var riskColor: Color {
        ScoreDesign.riskColor(data.riskScore)
    }

    var body: some View {

        ZStack {

            ScoreDesign.background
                .ignoresSafeArea()

            VStack(
                alignment: .leading,
                spacing: 0
            ) {

                // Header
                HStack {

                    ScoreLabel(
                        icon: "shield.fill",
                        title: "怪我リスク"
                    )

                    Spacer()

                    Circle()
                        .fill(riskColor)
                        .frame(width: 7, height: 7)
                        .shadow(
                            color: riskColor.opacity(0.8),
                            radius: 5
                        )
                }

                Spacer(minLength: 4)

                // Main score
                HStack(
                    alignment: .firstTextBaseline,
                    spacing: 5
                ) {

                    Text("\(data.riskScore)")
                        .font(
                            .system(
                                size: 48,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(ScoreDesign.primaryText)
                        .monospacedDigit()

                    Text("/100")
                        .font(
                            .system(
                                size: 12,
                                weight: .medium,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(ScoreDesign.tertiaryText)
                }

                // Risk badge
                Text(data.riskLabel)
                    .font(
                        .system(
                            size: 10,
                            weight: .bold,
                            design: .rounded
                        )
                    )
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(riskColor)
                    )
                    .padding(.top, 2)

                Spacer(minLength: 10)

                // Bar
                RiskProgressBar(score: data.riskScore)

                HStack {

                    Text("LOW")
                    Spacer()
                    Text("HIGH")
                }
                .font(
                    .system(
                        size: 7,
                        weight: .bold,
                        design: .rounded
                    )
                )
                .foregroundStyle(ScoreDesign.tertiaryText)
                .padding(.top, 4)
            }
            .padding(16)
        }
        .containerBackground(
            ScoreDesign.background,
            for: .widget
        )
        .widgetURL(
            URL(string: "score://risk")
        )
    }
}


// MARK: - 2. Competition Countdown

struct CompetitionCountdownWidgetView: View {

    let entry: ScoreWidgetEntry

    var data: ScoreWidgetData {
        entry.data
    }

    var body: some View {

        ZStack {

            ScoreDesign.background
                .ignoresSafeArea()

            VStack(
                alignment: .leading,
                spacing: 0
            ) {

                HStack {

                    ScoreLabel(
                        icon: "flag.fill",
                        title: "次の大会まで"
                    )

                    Spacer()

                    Image(systemName: "arrow.up.right")
                        .font(
                            .system(
                                size: 11,
                                weight: .semibold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.tertiaryText
                        )
                }

                Spacer()

                if let days = data.daysUntilCompetition {

                    HStack(
                        alignment: .firstTextBaseline,
                        spacing: 6
                    ) {

                        Text("\(max(days, 0))")
                            .font(
                                .system(
                                    size: 58,
                                    weight: .bold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.primaryText
                            )
                            .monospacedDigit()

                        Text("DAYS")
                            .font(
                                .system(
                                    size: 11,
                                    weight: .bold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.mint
                            )
                    }

                    Text(
                        data.competitionName ?? "大会予定あり"
                    )
                    .font(
                        .system(
                            size: 13,
                            weight: .medium,
                            design: .default
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.secondaryText
                    )
                    .lineLimit(2)
                    .padding(.top, 2)

                } else {

                    Image(systemName: "calendar.badge.exclamationmark")
                        .font(.system(size: 26))
                        .foregroundStyle(
                            ScoreDesign.tertiaryText
                        )

                    Text("予定なし")
                        .font(
                            .system(
                                size: 24,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.primaryText
                        )
                        .padding(.top, 5)
                }

                Spacer()

                Rectangle()
                    .fill(ScoreDesign.blue.opacity(0.7))
                    .frame(width: 34, height: 3)
            }
            .padding(16)
        }
        .containerBackground(
            ScoreDesign.background,
            for: .widget
        )
        .widgetURL(
            URL(string: "score://competition")
        )
    }
}


// MARK: - 3. Streak Widget

struct StreakWidgetView: View {

    let entry: ScoreWidgetEntry

    var data: ScoreWidgetData {
        entry.data
    }

    var body: some View {

        ZStack {

            ScoreDesign.background
                .ignoresSafeArea()

            // Subtle glow
            Circle()
                .fill(
                    Color.orange.opacity(0.10)
                )
                .frame(width: 130)
                .blur(radius: 28)
                .offset(
                    x: 35,
                    y: -50
                )

            VStack(
                alignment: .leading,
                spacing: 0
            ) {

                HStack {

                    ScoreLabel(
                        icon: "flame.fill",
                        title: "連続記録"
                    )

                    Spacer()

                    Image(systemName: "bolt.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(
                            Color.orange
                        )
                }

                Spacer()

                HStack(
                    alignment: .center,
                    spacing: 10
                ) {

                    ZStack {

                        Circle()
                            .fill(
                                Color.orange.opacity(0.13)
                            )
                            .frame(
                                width: 43,
                                height: 43
                            )

                        Text("🔥")
                            .font(.system(size: 23))
                    }

                    VStack(
                        alignment: .leading,
                        spacing: -2
                    ) {

                        HStack(
                            alignment: .firstTextBaseline,
                            spacing: 4
                        ) {

                            Text("\(data.streak)")
                                .font(
                                    .system(
                                        size: 43,
                                        weight: .bold,
                                        design: .rounded
                                    )
                                )
                                .foregroundStyle(
                                    ScoreDesign.primaryText
                                )
                                .monospacedDigit()

                            Text("日")
                                .font(
                                    .system(
                                        size: 13,
                                        weight: .semibold,
                                        design: .rounded
                                    )
                                )
                                .foregroundStyle(
                                    ScoreDesign.secondaryText
                                )
                        }

                        Text(
                            data.streak >= 7
                                ? "習慣が力になる"
                                : "今日も積み上げよう"
                        )
                        .font(
                            .system(
                                size: 10,
                                weight: .medium
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )
                    }
                }

                Spacer()

                HStack(spacing: 4) {

                    ForEach(
                        0..<min(max(data.streak, 0), 7),
                        id: \.self
                    ) { _ in

                        RoundedRectangle(
                            cornerRadius: 2
                        )
                        .fill(
                            Color.orange.opacity(0.8)
                        )
                        .frame(height: 4)
                    }
                }
            }
            .padding(16)
        }
        .containerBackground(
            ScoreDesign.background,
            for: .widget
        )
        .widgetURL(
            URL(string: "score://streak")
        )
    }
}


// MARK: - 4. Recovery Widget

struct RecoveryProgressWidgetView: View {

    let entry: ScoreWidgetEntry

    var data: ScoreWidgetData {
        entry.data
    }

    private var progress: Double {
        Double(
            min(
                max(
                    data.recoveryProgressPercent ?? 0,
                    0
                ),
                100
            )
        ) / 100
    }

    var body: some View {

        ZStack {

            ScoreDesign.background
                .ignoresSafeArea()

            VStack(
                alignment: .leading,
                spacing: 0
            ) {

                // Header
                HStack {

                    ScoreLabel(
                        icon: "heart.text.square.fill",
                        title: "復帰プラン"
                    )

                    Spacer()

                    if let phase = data.recoveryPhase {

                        Text(phase)
                            .font(
                                .system(
                                    size: 10,
                                    weight: .bold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.mint
                            )
                            .padding(
                                .horizontal,
                                9
                            )
                            .padding(
                                .vertical,
                                5
                            )
                            .background(
                                Capsule()
                                    .fill(
                                        ScoreDesign.green
                                            .opacity(0.20)
                                    )
                            )
                    }
                }

                Spacer()

                if let day = data.recoveryDay,
                   let total = data.recoveryTotalDays {

                    // Day X / Y
                    HStack(
                        alignment: .firstTextBaseline,
                        spacing: 7
                    ) {

                        Text("Day")
                            .font(
                                .system(
                                    size: 15,
                                    weight: .semibold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.secondaryText
                            )

                        Text("\(day)")
                            .font(
                                .system(
                                    size: 39,
                                    weight: .bold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.primaryText
                            )
                            .monospacedDigit()

                        Text("/")
                            .font(
                                .system(
                                    size: 24,
                                    weight: .medium,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.tertiaryText
                            )

                        Text("\(total)")
                            .font(
                                .system(
                                    size: 24,
                                    weight: .semibold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.secondaryText
                            )
                            .monospacedDigit()

                        Spacer()

                        Text(
                            "\(data.recoveryProgressPercent ?? 0)%"
                        )
                        .font(
                            .system(
                                size: 17,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.mint
                        )
                        .monospacedDigit()
                    }

                    Spacer(minLength: 12)

                    // Progress
                    GeometryReader { proxy in

                        ZStack(alignment: .leading) {

                            Capsule()
                                .fill(
                                    ScoreDesign.surfaceSecondary
                                )

                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            ScoreDesign.green,
                                            ScoreDesign.mint
                                        ],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(
                                    width: max(
                                        8,
                                        proxy.size.width * progress
                                    )
                                )
                        }
                    }
                    .frame(height: 9)

                    Spacer(minLength: 9)

                    HStack {

                        Text("START")

                        Spacer()

                        Text("RECOVERY")

                        Spacer()

                        Text("RETURN")
                    }
                    .font(
                        .system(
                            size: 7,
                            weight: .bold,
                            design: .rounded
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.tertiaryText
                    )

                } else {

                    Image(
                        systemName:
                            "heart.text.square"
                    )
                    .font(.system(size: 28))
                    .foregroundStyle(
                        ScoreDesign.tertiaryText
                    )

                    Text("進行中のプランなし")
                        .font(
                            .system(
                                size: 18,
                                weight: .bold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.primaryText
                        )
                        .padding(.top, 8)
                }
            }
            .padding(18)
        }
        .containerBackground(
            ScoreDesign.background,
            for: .widget
        )
        .widgetURL(
            URL(string: "score://recovery")
        )
    }
}


// MARK: - 5. Dashboard Widget

struct DashboardWidgetView: View {

    let entry: ScoreWidgetEntry

    var data: ScoreWidgetData {
        entry.data
    }

    var body: some View {

        ZStack {

            ScoreDesign.background
                .ignoresSafeArea()

            VStack(
                alignment: .leading,
                spacing: 0
            ) {

                // ------------------------------------------------
                // Top Header
                // ------------------------------------------------

                HStack {

                    HStack(spacing: 8) {

                        ZStack {

                            RoundedRectangle(
                                cornerRadius: 7
                            )
                            .fill(
                                ScoreDesign.green
                            )
                            .frame(
                                width: 29,
                                height: 29
                            )

                            Text("S")
                                .font(
                                    .system(
                                        size: 17,
                                        weight: .black,
                                        design: .rounded
                                    )
                                )
                                .foregroundStyle(.white)
                        }

                        Text("sCORE")
                            .font(
                                .system(
                                    size: 15,
                                    weight: .bold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.primaryText
                            )
                    }

                    Spacer()

                    Text("TRAINING DASHBOARD")
                        .font(
                            .system(
                                size: 7,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .tracking(1.2)
                        .foregroundStyle(
                            ScoreDesign.tertiaryText
                        )
                }

                Spacer(minLength: 12)

                // ------------------------------------------------
                // Main Grid
                // ------------------------------------------------

                HStack(
                    spacing: 8
                ) {

                    // Risk
                    DashboardRiskCard(
                        data: data
                    )

                    // Right column
                    VStack(
                        spacing: 8
                    ) {

                        DashboardCountdownCard(
                            data: data
                        )

                        DashboardStreakCard(
                            data: data
                        )
                    }
                }

                Spacer(minLength: 8)

                // ------------------------------------------------
                // Recovery
                // ------------------------------------------------

                DashboardRecoveryCard(
                    data: data
                )

                Spacer(minLength: 7)

                HStack {

                    Circle()
                        .fill(
                            ScoreDesign.mint
                        )
                        .frame(
                            width: 5,
                            height: 5
                        )

                    Text("今日も積み重ねが、未来をつくる。")
                        .font(
                            .system(
                                size: 9,
                                weight: .medium
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )

                    Spacer()

                    Image(
                        systemName: "arrow.up.right"
                    )
                    .font(
                        .system(
                            size: 9,
                            weight: .bold
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.tertiaryText
                    )
                }
            }
            .padding(16)
        }
        .containerBackground(
            ScoreDesign.background,
            for: .widget
        )
        .widgetURL(
            URL(string: "score://dashboard")
        )
    }
}


// MARK: - Dashboard Risk Card

struct DashboardRiskCard: View {

    let data: ScoreWidgetData

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: 7
        ) {

            HStack {

                Image(
                    systemName: "shield.fill"
                )
                .font(.system(size: 10))
                .foregroundStyle(
                    ScoreDesign.riskColor(
                        data.riskScore
                    )
                )

                Text("怪我リスク")
                    .font(
                        .system(
                            size: 10,
                            weight: .semibold
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.secondaryText
                    )

                Spacer()
            }

            Spacer()

            HStack(
                alignment: .firstTextBaseline,
                spacing: 4
            ) {

                Text("\(data.riskScore)")
                    .font(
                        .system(
                            size: 38,
                            weight: .bold,
                            design: .rounded
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.primaryText
                    )
                    .monospacedDigit()

                Text("/100")
                    .font(
                        .system(
                            size: 9,
                            weight: .medium,
                            design: .rounded
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.tertiaryText
                    )
            }

            Text(data.riskLabel)
                .font(
                    .system(
                        size: 9,
                        weight: .bold,
                        design: .rounded
                    )
                )
                .foregroundStyle(.white)
                .padding(
                    .horizontal,
                    7
                )
                .padding(
                    .vertical,
                    3
                )
                .background(
                    Capsule()
                        .fill(
                            ScoreDesign.riskColor(
                                data.riskScore
                            )
                        )
                )

            RiskProgressBar(
                score: data.riskScore
            )
            .padding(.top, 2)
        }
        .padding(12)
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .leading
        )
        .background(
            RoundedRectangle(
                cornerRadius: 14
            )
            .fill(
                ScoreDesign.surface
            )
        )
    }
}


// MARK: - Dashboard Countdown Card

struct DashboardCountdownCard: View {

    let data: ScoreWidgetData

    var body: some View {

        HStack {

            VStack(
                alignment: .leading,
                spacing: 0
            ) {

                HStack(spacing: 5) {

                    Image(
                        systemName: "flag.fill"
                    )
                    .font(.system(size: 9))
                    .foregroundStyle(
                        ScoreDesign.blue
                    )

                    Text("大会まで")
                        .font(
                            .system(
                                size: 9,
                                weight: .semibold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )
                }

                Spacer()

                if let days = data.daysUntilCompetition {

                    HStack(
                        alignment: .firstTextBaseline,
                        spacing: 4
                    ) {

                        Text("\(max(days, 0))")
                            .font(
                                .system(
                                    size: 27,
                                    weight: .bold,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.primaryText
                            )
                            .monospacedDigit()

                        Text("日")
                            .font(
                                .system(
                                    size: 9,
                                    weight: .bold
                                )
                            )
                            .foregroundStyle(
                                ScoreDesign.secondaryText
                            )
                    }

                    Text(
                        data.competitionName ?? ""
                    )
                    .font(
                        .system(
                            size: 8,
                            weight: .medium
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.tertiaryText
                    )
                    .lineLimit(1)
                } else {

                    Text("予定なし")
                        .font(
                            .system(
                                size: 14,
                                weight: .bold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.primaryText
                        )
                }
            }

            Spacer()
        }
        .padding(11)
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
        .background(
            RoundedRectangle(
                cornerRadius: 14
            )
            .fill(
                ScoreDesign.surface
            )
        )
    }
}


// MARK: - Dashboard Streak Card

struct DashboardStreakCard: View {

    let data: ScoreWidgetData

    var body: some View {

        HStack {

            Text("🔥")
                .font(.system(size: 20))

            VStack(
                alignment: .leading,
                spacing: -2
            ) {

                Text("連続記録")
                    .font(
                        .system(
                            size: 8,
                            weight: .semibold
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.secondaryText
                    )

                HStack(
                    alignment: .firstTextBaseline,
                    spacing: 3
                ) {

                    Text("\(data.streak)")
                        .font(
                            .system(
                                size: 22,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.primaryText
                        )
                        .monospacedDigit()

                    Text("日")
                        .font(
                            .system(
                                size: 8,
                                weight: .bold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )
                }
            }

            Spacer()
        }
        .padding(11)
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
        .background(
            RoundedRectangle(
                cornerRadius: 14
            )
            .fill(
                ScoreDesign.surface
            )
        )
    }
}


// MARK: - Dashboard Recovery Card

struct DashboardRecoveryCard: View {

    let data: ScoreWidgetData

    private var progress: Double {

        Double(
            min(
                max(
                    data.recoveryProgressPercent ?? 0,
                    0
                ),
                100
            )
        ) / 100
    }

    var body: some View {

        VStack(
            alignment: .leading,
            spacing: 7
        ) {

            HStack {

                HStack(spacing: 6) {

                    Image(
                        systemName:
                            "heart.text.square.fill"
                    )
                    .font(.system(size: 10))
                    .foregroundStyle(
                        ScoreDesign.mint
                    )

                    Text("復帰プラン")
                        .font(
                            .system(
                                size: 9,
                                weight: .semibold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )
                }

                Spacer()

                if let phase = data.recoveryPhase {

                    Text(phase)
                        .font(
                            .system(
                                size: 8,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.mint
                        )
                }
            }

            if let day = data.recoveryDay,
               let total = data.recoveryTotalDays {

                HStack(
                    alignment: .firstTextBaseline
                ) {

                    Text("Day")
                        .font(
                            .system(
                                size: 10,
                                weight: .semibold
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )

                    Text("\(day)")
                        .font(
                            .system(
                                size: 23,
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.primaryText
                        )
                        .monospacedDigit()

                    Text("/ \(total)")
                        .font(
                            .system(
                                size: 12,
                                weight: .medium,
                                design: .rounded
                            )
                        )
                        .foregroundStyle(
                            ScoreDesign.secondaryText
                        )
                        .monospacedDigit()

                    Spacer()

                    Text(
                        "\(data.recoveryProgressPercent ?? 0)%"
                    )
                    .font(
                        .system(
                            size: 12,
                            weight: .bold,
                            design: .rounded
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.mint
                    )
                }

                GeometryReader { proxy in

                    ZStack(alignment: .leading) {

                        Capsule()
                            .fill(
                                ScoreDesign.surfaceSecondary
                            )

                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        ScoreDesign.green,
                                        ScoreDesign.mint
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(
                                width: max(
                                    7,
                                    proxy.size.width * progress
                                )
                            )
                    }
                }
                .frame(height: 6)

            } else {

                Text("進行中のプランなし")
                    .font(
                        .system(
                            size: 12,
                            weight: .semibold
                        )
                    )
                    .foregroundStyle(
                        ScoreDesign.secondaryText
                    )
            }
        }
        .padding(12)
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
        .background(
            RoundedRectangle(
                cornerRadius: 14
            )
            .fill(
                ScoreDesign.surface
            )
        )
    }
}


// MARK: - Widget Configurations

struct RiskScoreWidget: Widget {

    let kind = "RiskScoreWidget"

    var body: some WidgetConfiguration {

        StaticConfiguration(
            kind: kind,
            provider: ScoreWidgetProvider()
        ) { entry in

            RiskScoreWidgetView(
                entry: entry
            )
        }
        .configurationDisplayName(
            "怪我リスクスコア"
        )
        .description(
            "現在の怪我リスクを一目で確認します。"
        )
        .supportedFamilies(
            [.systemSmall]
        )
        .contentMarginsDisabled()
    }
}


struct CompetitionCountdownWidget: Widget {

    let kind = "CompetitionCountdownWidget"

    var body: some WidgetConfiguration {

        StaticConfiguration(
            kind: kind,
            provider: ScoreWidgetProvider()
        ) { entry in

            CompetitionCountdownWidgetView(
                entry: entry
            )
        }
        .configurationDisplayName(
            "大会カウントダウン"
        )
        .description(
            "次の大会までの日数を表示します。"
        )
        .supportedFamilies(
            [.systemSmall]
        )
        .contentMarginsDisabled()
    }
}


struct StreakWidget: Widget {

    let kind = "StreakWidget"

    var body: some WidgetConfiguration {

        StaticConfiguration(
            kind: kind,
            provider: ScoreWidgetProvider()
        ) { entry in

            StreakWidgetView(
                entry: entry
            )
        }
        .configurationDisplayName(
            "連続記録ストリーク"
        )
        .description(
            "練習記録の連続日数を表示します。"
        )
        .supportedFamilies(
            [.systemSmall]
        )
        .contentMarginsDisabled()
    }
}


struct RecoveryProgressWidget: Widget {

    let kind = "RecoveryProgressWidget"

    var body: some WidgetConfiguration {

        StaticConfiguration(
            kind: kind,
            provider: ScoreWidgetProvider()
        ) { entry in

            RecoveryProgressWidgetView(
                entry: entry
            )
        }
        .configurationDisplayName(
            "復帰プラン進捗"
        )
        .description(
            "復帰プランの進捗を表示します。"
        )
        .supportedFamilies(
            [.systemMedium]
        )
        .contentMarginsDisabled()
    }
}


struct DashboardWidget: Widget {

    let kind = "DashboardWidget"

    var body: some WidgetConfiguration {

        StaticConfiguration(
            kind: kind,
            provider: ScoreWidgetProvider()
        ) { entry in

            DashboardWidgetView(
                entry: entry
            )
        }
        .configurationDisplayName(
            "sCORE ダッシュボード"
        )
        .description(
            "怪我リスク、大会、連続記録、復帰状況をまとめて表示します。"
        )
        .supportedFamilies(
            [.systemLarge]
        )
        .contentMarginsDisabled()
    }
}


// MARK: - Widget Bundle

@main
struct ScoreWidgetsBundle: WidgetBundle {

    var body: some Widget {

        RiskScoreWidget()

        CompetitionCountdownWidget()

        StreakWidget()

        RecoveryProgressWidget()

        DashboardWidget()
    }
}
