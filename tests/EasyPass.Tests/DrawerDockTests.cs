using EasyPass.Core;

namespace EasyPass.Tests;

public class DrawerDockTests
{
    static readonly DockArea Screen = new(0, 0, 1000, 800);

    [Theory]
    [InlineData(990, 400, DockEdge.Right)]
    [InlineData(10, 400, DockEdge.Left)]
    [InlineData(500, 10, DockEdge.Top)]
    [InlineData(500, 790, DockEdge.Bottom)]
    public void Nearest_picks_the_closest_edge(double x, double y, DockEdge expected) =>
        Assert.Equal(expected, DrawerDock.Nearest(Screen, x, y, DockEdge.Right, 0));

    [Fact]
    public void Nearest_keeps_the_edge_in_a_corner_until_another_is_clearly_closer()
    {
        Assert.Equal(DockEdge.Right, DrawerDock.Nearest(Screen, 980, 10, DockEdge.Right, 40)); // top by 10, right by 20
        Assert.Equal(DockEdge.Top, DrawerDock.Nearest(Screen, 900, 10, DockEdge.Right, 40));
    }

    [Fact]
    public void Right_edge_box_touches_the_wall_and_centers_the_panel_on_the_handle()
    {
        var box = DrawerDock.Box(DockEdge.Right, Screen, 999, 400, 280, 300, 18, 44);
        Assert.Equal(1000, box.Left + box.Width);
        Assert.Equal(280 + 18 + DrawerDock.Overshoot, box.Width);
        Assert.Equal(300 + 2 * DrawerDock.Pad, box.Height);
        Assert.Equal(400, box.Top + box.Height / 2);
        Assert.Equal(400, box.Top + box.TabOffset + 22);
    }

    [Fact]
    public void Left_edge_box_starts_at_the_wall() =>
        Assert.Equal(0, DrawerDock.Box(DockEdge.Left, Screen, 1, 400, 280, 300, 18, 44).Left);

    [Fact]
    public void Near_a_corner_the_window_stays_on_the_screen_and_the_handle_inside_the_panel_ends()
    {
        var box = DrawerDock.Box(DockEdge.Right, Screen, 999, 790, 280, 300, 18, 44);
        Assert.Equal(800, box.Top + box.Height);
        var panelEnd = box.Top + DrawerDock.Pad + box.PanelAlong;
        Assert.Equal(panelEnd - DrawerDock.TabInset, box.Top + box.TabOffset + 44);
    }

    [Theory]
    [InlineData(DockEdge.Top, 0)]
    [InlineData(DockEdge.Bottom, 800 - 300 - 18 - DrawerDock.Overshoot)]
    public void Horizontal_edges_stack_panel_and_handle(DockEdge edge, double top)
    {
        var box = DrawerDock.Box(edge, Screen, 500, 0, 280, 300, 18, 44);
        Assert.Equal(top, box.Top);
        Assert.Equal(280 + 2 * DrawerDock.Pad, box.Width);
        Assert.Equal(300 + 18 + DrawerDock.Overshoot, box.Height);
    }

    [Fact]
    public void Panel_taller_than_the_screen_is_cut_to_it()
    {
        var box = DrawerDock.Box(DockEdge.Right, new DockArea(0, 0, 1000, 200), 999, 100, 280, 500, 18, 44);
        Assert.Equal(200, box.Height);
        Assert.Equal(0, box.Top);
        Assert.Equal(200 - 2 * DrawerDock.Pad, box.PanelAlong);
    }

    [Fact]
    public void Save_reads_back() => Assert.Equal((DockEdge.Bottom, 12.0, -340.0), DrawerDock.Parse(DrawerDock.Save(DockEdge.Bottom, 12, -340)));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Right,1")]
    [InlineData("Up,1,2")]
    [InlineData("7,1,2")]
    [InlineData("Right,x,2")]
    [InlineData("Right,NaN,2")]
    public void Anything_else_reads_as_nothing(string? text) => Assert.Null(DrawerDock.Parse(text));

    static List<double> Run(DrawerMotion motion, double seconds, double frame = 1 / 60.0)
    {
        var values = new List<double>();
        for (var t = 0.0; t < seconds; t += frame) { motion.Step(frame); values.Add(motion.Value); }
        return values;
    }

    [Fact]
    public void Opening_overshoots_a_little_then_rests_open()
    {
        var motion = new DrawerMotion();
        motion.Open();
        var values = Run(motion, 2);
        Assert.InRange(values.Max(), 1.01, 1.08);
        Assert.Equal(1, motion.Value);
        Assert.False(motion.Moving);
    }

    [Fact]
    public void Closing_takes_a_third_of_a_second_never_goes_below_closed_and_never_turns_back()
    {
        var motion = new DrawerMotion();
        motion.Jump(1);
        motion.Close();
        var values = Run(motion, 0.34 + 0.02);
        Assert.Equal(0, motion.Value);
        Assert.False(motion.Moving);
        Assert.All(values, v => Assert.InRange(v, 0, 1));
        Assert.Equal(values.OrderDescending(), values);
    }

    [Fact]
    public void Turning_back_mid_slide_continues_from_where_it_is()
    {
        var motion = new DrawerMotion();
        motion.Open();
        Run(motion, 0.1);
        var at = motion.Value;
        motion.Close();
        motion.Step(1 / 240.0);
        Assert.InRange(motion.Value, at - 0.02, at);
        Run(motion, 0.05);
        var closing = motion.Value;
        motion.Open();
        motion.Step(1 / 240.0);
        Assert.InRange(motion.Value, closing - 0.02, closing + 0.02);
    }

    [Fact]
    public void A_long_stall_does_not_shake_the_spring()
    {
        var motion = new DrawerMotion();
        motion.Open();
        motion.Step(1.5);
        Assert.InRange(motion.Value, 0.9, 1.1);
    }

    static (double Start, IReadOnlyList<DockCurve> Curves) Shape(double open) => DrawerShape.Outline(open, 140, 44, 18, 20, 300, 280, 340);

    [Fact]
    public void Closed_the_shape_is_only_the_handle()
    {
        var (start, curves) = Shape(0);
        Assert.Equal(18, curves.Max(c => c.Depth));
        Assert.Equal(140 - 6, start);
        Assert.Equal(184 + 6, curves[^1].Along);
    }

    [Fact]
    public void Open_the_shape_is_the_panel_with_the_handle_on_its_free_side()
    {
        var (start, curves) = Shape(1);
        Assert.Equal(280 + 18, curves.Max(c => c.Depth));
        Assert.Equal(20 - 10, start, 6);
        Assert.Equal(320 + 10, curves[^1].Along, 6);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(0.02)]
    [InlineData(0.16)]
    [InlineData(0.5)]
    [InlineData(0.95)]
    [InlineData(1)]
    [InlineData(1.04)]
    public void The_outline_goes_one_way_and_stays_in_the_window(double open)
    {
        var (start, curves) = Shape(open);
        var along = start;
        foreach (var curve in curves)
        {
            Assert.True(curve.Along >= along - 1e-9, $"backtracks at {curve} on {open}");
            along = curve.Along;
            Assert.InRange(curve.Along, 0, 340);
            Assert.InRange(curve.Depth, 0, 280 + 18 + DrawerDock.Overshoot);
        }
        Assert.Equal(0, curves[^1].Depth);
    }

    [Fact]
    public void A_handle_at_the_end_of_the_panel_still_stays_clear_of_the_corner()
    {
        var (start, curves) = DrawerShape.Outline(0.3, 36, 44, 18, 20, 300, 280, 340);
        var along = start;
        foreach (var curve in curves) { Assert.True(curve.Along >= along - 1e-9, $"backtracks at {curve}"); along = curve.Along; }
    }
}
